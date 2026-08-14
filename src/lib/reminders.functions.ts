import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReminderType = "hydration" | "sleep" | "protein" | "daily_summary" | "inactivity" | "workout";

const REMINDER_TYPES = ["hydration", "sleep", "protein", "daily_summary", "inactivity", "workout"] as const;

const upsertSchema = z.object({
  type: z.enum(REMINDER_TYPES),
  enabled: z.boolean(),
  time_local: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  threshold: z.number().nullable().optional(),
});

export const listReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reminder_settings")
      .select("*")
      .order("type");
    if (error) {
      console.error("reminder settings read failed", error);
      throw new Error("Impossible de charger les rappels.");
    }
    return { reminders: data ?? [] };
  });

export const upsertReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reminder_settings")
      .upsert(
        {
          user_id: context.userId,
          type: data.type,
          enabled: data.enabled,
          time_local: data.time_local ?? null,
          timezone: data.timezone ?? "Europe/Paris",
          threshold: data.threshold ?? null,
        },
        { onConflict: "user_id,type" },
      );
    if (error) {
      console.error("reminder settings write failed", error);
      throw new Error("Impossible d'enregistrer le rappel.");
    }
    return { ok: true };
  });
