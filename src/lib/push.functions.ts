import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEGAL_VERSIONS } from "./legal";

const testNotificationSchema = z.object({
  title: z.string().trim().max(100).optional(),
  message: z.string().trim().max(500).optional(),
});

export const getOneSignalConfig = createServerFn({ method: "GET" }).handler(async () => {
  const appId = process.env.ONESIGNAL_APP_ID ?? null;
  return { appId };
});

export const sendTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => testNotificationSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const { data: consent, error: consentError } = await context.supabase
      .from("legal_consent")
      .select("opts")
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (consentError) {
      console.error("notification consent lookup failed", consentError);
      throw new Error("Impossible de vérifier le consentement aux notifications.");
    }
    if ((consent?.opts as { notifications?: boolean } | null)?.notifications !== true) {
      throw new Error("Consentement Notifications requis");
    }

    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!appId || !apiKey) throw new Error("Notifications non configurées");

    const { data: subscriptions, error: subscriptionError } = await context.supabase
      .from("push_subscriptions")
      .select("onesignal_subscription_id")
      .eq("user_id", context.userId);
    if (subscriptionError) {
      console.error("push subscription lookup failed", subscriptionError);
      throw new Error("Impossible de récupérer les appareils de notification.");
    }

    const subscriptionIds = (subscriptions ?? [])
      .map((row) => (row as { onesignal_subscription_id: string }).onesignal_subscription_id)
      .filter(Boolean);
    if (!subscriptionIds.length) {
      throw new Error("Aucun appareil n'est actuellement inscrit aux notifications.");
    }

    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_subscription_ids: subscriptionIds,
        target_channel: "push",
        headings: { en: data.title ?? "Pace", fr: data.title ?? "Pace" },
        contents: {
          en: data.message ?? "Push notifications are working.",
          fr: data.message ?? "Les notifications fonctionnent.",
        },
      }),
    });

    const json = (await res.json()) as { id?: string; errors?: unknown; recipients?: number };
    if (!res.ok || json.errors) {
      console.error("OneSignal API error", json);
      return { ok: false, error: "Impossible d'envoyer la notification." };
    }
    return { ok: true, id: json.id, recipients: json.recipients ?? 0 };
  });
