import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEGAL_VERSIONS } from "./legal";

const testNotificationSchema = z.object({
  title: z.string().trim().max(100).optional(),
  message: z.string().trim().max(500).optional(),
});

export const getOneSignalConfig = createServerFn({ method: "GET" }).handler(async () => {
  const appId = process.env.ONESIGNAL_APP_ID;
  if (!appId) throw new Error("ONESIGNAL_APP_ID not configured");
  return { appId };
});

export const sendTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => testNotificationSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const { data: consent, error: consentError } = await context.supabase
      .from("legal_consent")
      .select("opts")
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (consentError) throw new Error(consentError.message);
    if ((consent?.opts as { notifications?: boolean } | null)?.notifications !== true) {
      throw new Error("Consentement Notifications requis");
    }
    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!appId || !apiKey) throw new Error("OneSignal non configuré");

    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_aliases: { external_id: [context.userId] },
        target_channel: "push",
        headings: { en: data.title ?? "Pace", fr: data.title ?? "Pace" },
        contents: {
          en: data.message ?? "Push notifications are working 🎉",
          fr: data.message ?? "Les notifications fonctionnent 🎉",
        },
      }),
    });

    const json = (await res.json()) as { id?: string; errors?: unknown; recipients?: number };
    if (!res.ok || json.errors) {
      console.error("OneSignal error", json);
      return { ok: false, error: JSON.stringify(json.errors ?? json) };
    }
    return { ok: true, id: json.id, recipients: json.recipients ?? 0 };
  });
