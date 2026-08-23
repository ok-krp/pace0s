import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listReminderDebug = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reminder_debug_log")
      .select("id, type, status, reason, trigger, target_segment, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("reminder debug read failed", error);
      throw new Error("Impossible de charger les journaux de rappels.");
    }
    return { entries: data ?? [] };
  });
