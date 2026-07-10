import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SampleType = z.enum(["steps", "kcal_active", "heart_rate", "distance_m", "sleep_min"]);

const insertSchema = z.object({
  samples: z.array(z.object({
    ts: z.string(),
    type: SampleType,
    value: z.number().finite(),
    source: z.string().max(64).default("manual"),
  })).min(1).max(5000),
});

export const insertHealthSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => insertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const rows = data.samples.map((s) => ({ ...s, user_id: context.userId }));
    const { error, count } = await context.supabase.from("health_samples").insert(rows, { count: "exact" });
    if (error) throw new Error(error.message);
    return { inserted: count ?? rows.length };
  });

export const listHealthToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { data, error } = await context.supabase
      .from("health_samples")
      .select("type, value, ts, source")
      .gte("ts", start.toISOString())
      .order("ts", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const sum = (t: string) => rows.filter((r) => r.type === t).reduce((s, r) => s + Number(r.value), 0);
    return {
      steps: Math.round(sum("steps")),
      kcalActive: Math.round(sum("kcal_active")),
      distanceM: Math.round(sum("distance_m")),
      sleepMin: Math.round(sum("sleep_min")),
      lastSource: rows[0]?.source ?? null,
      lastTs: rows[0]?.ts ?? null,
      count: rows.length,
    };
  });
