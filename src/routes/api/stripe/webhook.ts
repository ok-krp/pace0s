import { createFileRoute } from "@tanstack/react-router";
import { applyStripeSubscription, verifyStripeSignature } from "@/lib/billing.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MAX_BODY_BYTES = 512_000;

/** Lit le corps en flux et arrête la lecture dès que la limite en octets est dépassée. */
async function readBoundedBody(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return new Response("Stripe webhook non configuré", { status: 503 });
        const raw = await readBoundedBody(request, MAX_BODY_BYTES);
        if (raw === null) return new Response("Payload trop volumineux", { status: 413 });
        const signature = request.headers.get("stripe-signature") ?? "";
        if (!verifyStripeSignature(raw, signature, secret)) return new Response("Signature Stripe invalide", { status: 400 });

        let event: { id: string; type: string; data: { object: Record<string, unknown> } };
        try {
          event = JSON.parse(raw) as typeof event;
        } catch {
          return new Response("JSON Stripe invalide", { status: 400 });
        }

        if (!event || typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
          return new Response("Événement Stripe invalide", { status: 400 });
        }

        const { data: seen, error: seenError } = await supabaseAdmin
          .from("billing_events")
          .select("stripe_event_id,status")
          .eq("stripe_event_id", event.id)
          .maybeSingle();
        if (seenError) return new Response("Impossible de vérifier l'événement Stripe", { status: 500 });
        if (seen?.status === "processed") return Response.json({ received: true, duplicate: true });

        // Recover an event left in processing by a crashed serverless invocation.
        let alreadyClaimed = false;
        if (seen?.status === "processing") {
          const now = new Date().toISOString();
          const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
          const { data: takeover, error: takeoverError } = await supabaseAdmin.from("billing_events")
            .update({ processed_at: now })
            .eq("stripe_event_id", event.id)
            .eq("status", "processing")
            .lt("processed_at", staleBefore)
            .select("stripe_event_id");
          if (takeoverError) return new Response("Impossible de reprendre l'événement", { status: 500 });
          if (takeover?.length) alreadyClaimed = true;
          else return new Response("Événement Stripe déjà en cours de traitement", { status: 500 });
        }

        // Claim a failed event by conditional update. Do not then attempt a second INSERT:
        // the unique-key conflict would otherwise return 200 without retrying the event.
        if (seen?.status === "failed") {
          const { data: retried, error: retryError } = await supabaseAdmin
            .from("billing_events")
            .update({ status: "processing", last_error: null, processed_at: new Date().toISOString() })
            .eq("stripe_event_id", event.id)
            .eq("status", "failed")
            .select("stripe_event_id");
          if (retryError) return new Response("Impossible de relancer l'événement", { status: 500 });
          if (retried?.length) alreadyClaimed = true;
          else {
            const { data: current } = await supabaseAdmin.from("billing_events").select("status").eq("stripe_event_id", event.id).maybeSingle();
            if (current?.status === "processing" || current?.status === "processed") return Response.json({ received: true, duplicate: true });
            return new Response("Impossible de relancer l'événement", { status: 500 });
          }
        }

        if (!alreadyClaimed) {
          const { error: eventError } = await supabaseAdmin.from("billing_events").insert({
            stripe_event_id: event.id,
            event_type: event.type,
            payload: event as never,
            status: "processing",
          });
          if (eventError) {
            const { data: raced, error: racedError } = await supabaseAdmin
              .from("billing_events")
              .select("stripe_event_id,status")
              .eq("stripe_event_id", event.id)
              .maybeSingle();
            if (racedError) return new Response("Impossible de vérifier l'événement concurrent", { status: 500 });
            if (raced?.status === "processed") return Response.json({ received: true, duplicate: true });
            // Do not acknowledge a concurrent in-flight event: if its worker fails,
            // Stripe must retry instead of permanently dropping this delivery.
            if (raced?.status === "processing") return new Response("Événement Stripe déjà en cours de traitement", { status: 500 });
            return new Response("Impossible d'enregistrer l'événement", { status: 500 });
          }
        }

        try {
          if (event.type === "checkout.session.completed") {
            const session = event.data.object as { customer?: string; client_reference_id?: string };
            if (session.customer && session.client_reference_id) {
              const { error: customerError } = await supabaseAdmin.from("billing_customers").upsert({
                user_id: session.client_reference_id,
                stripe_customer_id: session.customer,
              });
              if (customerError) throw new Error("Impossible d'enregistrer le client Stripe.");
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

        const { error: processedError } = await supabaseAdmin
          .from("billing_events")
          .update({ status: "processed", last_error: null })
          .eq("stripe_event_id", event.id);
        if (processedError) {
          console.error("Stripe webhook status persistence failed", { eventId: event.id, type: event.type, error: processedError });
          const { error: failedStatusError } = await supabaseAdmin
            .from("billing_events")
            .update({ status: "failed", last_error: "Impossible d'enregistrer le statut traité." })
            .eq("stripe_event_id", event.id)
            .eq("status", "processing");
          if (failedStatusError) console.error("Stripe webhook failed-status persistence failed", { eventId: event.id, error: failedStatusError });
          return new Response("Impossible d'enregistrer le statut de l'événement Stripe", { status: 500 });
        }
        return Response.json({ received: true });
      },
    },
  },
});
