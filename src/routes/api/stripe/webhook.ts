import { createFileRoute } from "@tanstack/react-router";
import { applyStripeSubscription, verifyStripeSignature } from "@/lib/billing.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return new Response("Stripe webhook non configuré", { status: 503 });
        const raw = await request.text();
        const signature = request.headers.get("stripe-signature") ?? "";
        if (!verifyStripeSignature(raw, signature, secret)) return new Response("Signature Stripe invalide", { status: 400 });

        let event: { id: string; type: string; data: { object: Record<string, unknown> } };
        try {
          event = JSON.parse(raw) as typeof event;
        } catch {
          return new Response("JSON Stripe invalide", { status: 400 });
        }

        const { data: seen } = await supabaseAdmin
          .from("billing_events")
          .select("stripe_event_id,status")
          .eq("stripe_event_id", event.id)
          .maybeSingle();
        if (seen?.status === "processed" || seen?.status === "processing") return Response.json({ received: true, duplicate: true });
        if (seen?.status === "failed") {
          await supabaseAdmin.from("billing_events").update({ status: "processing", last_error: null }).eq("stripe_event_id", event.id);
        }

        const { error: eventError } = await supabaseAdmin.from("billing_events").insert({
          stripe_event_id: event.id,
          event_type: event.type,
          payload: event as never,
          status: "processing",
        });
        if (eventError) {
          const { data: raced } = await supabaseAdmin.from("billing_events").select("stripe_event_id,status").eq("stripe_event_id", event.id).maybeSingle();
          if (raced?.status === "processed" || raced?.status === "processing") return Response.json({ received: true, duplicate: true });
          if (raced?.status === "failed") await supabaseAdmin.from("billing_events").update({ status: "processing", last_error: null }).eq("stripe_event_id", event.id);
          return new Response("Impossible d'enregistrer l'événement", { status: 500 });
        }

        try {
          if (event.type === "checkout.session.completed") {
            const session = event.data.object as { customer?: string; client_reference_id?: string };
            if (session.customer && session.client_reference_id) {
              await supabaseAdmin.from("billing_customers").upsert({
                user_id: session.client_reference_id,
                stripe_customer_id: session.customer,
              });
            }
          }

          if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
            await applyStripeSubscription(supabaseAdmin, event.data.object as never);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await supabaseAdmin.from("billing_events").update({ status: "failed", last_error: message }).eq("stripe_event_id", event.id);
          console.error("Stripe webhook processing failed", { eventId: event.id, type: event.type, error });
          return new Response("Webhook processing failed", { status: 500 });
        }

        await supabaseAdmin.from("billing_events").update({ status: "processed", last_error: null }).eq("stripe_event_id", event.id);
        return Response.json({ received: true });
      },
    },
  },
});
