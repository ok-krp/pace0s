import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const subscriptionSchema = z.object({
  subscriptionId: z.string().trim().min(1).max(200),
  platform: z.enum(["web", "android", "ios"]).default("web"),
});

export const registerPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => subscriptionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("push_subscriptions").upsert(
      {
        user_id: context.userId,
        onesignal_subscription_id: data.subscriptionId,
        platform: data.platform,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "user_id,onesignal_subscription_id" },
    );
    if (error) {
      console.error("push subscription registration failed", error);
      throw new Error("Impossible d'enregistrer cet appareil pour les notifications.");
    }
    return { ok: true };
  });

export const unregisterPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => subscriptionSchema.pick({ subscriptionId: true }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.userId)
      .eq("onesignal_subscription_id", data.subscriptionId);
    if (error) {
      console.error("push subscription removal failed", error);
      throw new Error("Impossible de désactiver cet appareil pour les notifications.");
    }
    return { ok: true };
  });
