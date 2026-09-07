import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const agentSchema = z.enum(["coach", "build"]);

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
    const column = data.agentType === "coach" ? "coach_ai_source" : "build_ai_source";
    const value = data.enabled ? "local" : "pace";
    const { error } = await context.supabase
      .from("ai_preferences")
      .upsert({ user_id: context.userId, [column]: value }, { onConflict: "user_id" });
    if (error) throw new Error("Impossible d’enregistrer le mode IA.");
    return { ok: true, source: value as "local" | "pace" };
  });
