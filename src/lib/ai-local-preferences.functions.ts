import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const agentSchema = z.enum(["coach", "build"]);
type AiPreferencesInsert = Database["public"]["Tables"]["ai_preferences"]["Insert"];

export const getAiLocalSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_preferences")
      .select("coach_ai_source,build_ai_source")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error("Impossible de charger le mode IA local.");
    return {
      coach: data?.coach_ai_source === "local",
      build: data?.build_ai_source === "local",
    };
  });

export const saveAiLocalSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ agentType: agentSchema, enabled: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const value: "local" | "pace" = data.enabled ? "local" : "pace";
    const payload: AiPreferencesInsert = data.agentType === "coach"
      ? { user_id: context.userId, coach_ai_source: value }
      : { user_id: context.userId, build_ai_source: value };
    const { error } = await context.supabase
      .from("ai_preferences")
      .upsert(payload, { onConflict: "user_id" });
    if (error) throw new Error("Impossible d’enregistrer le mode IA.");
    return { ok: true, source: value };
  });
