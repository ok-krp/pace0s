import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SampleType = z.enum([
  "steps", "kcal_active", "kcal_total", "heart_rate", "resting_heart_rate",
  "distance_m", "sleep_min", "exercise_duration_min", "weight_kg",
  "oxygen_saturation", "temperature_c", "cadence_rpm", "power_w",
]);

const insertSchema = z.object({
  samples: z.array(z.object({
    ts: z.string(),
    type: SampleType,
    value: z.number().finite(),
    source: z.string().max(128).default("manual"),
    source_id: z.string().max(128).optional(),
    external_id: z.string().max(256).optional(),
    metadata: z.record(z.unknown()).optional(),
  })).min(1).max(5000),
});

export const insertHealthSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => insertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const rows = data.samples.map((s) => ({ ...s, user_id: context.userId, metadata: s.metadata ?? {} }));
    const externalIds = rows.map((r) => r.external_id).filter((v): v is string => !!v);
    const existing = externalIds.length
      ? await context.supabase.from("health_samples").select("external_id").eq("user_id", context.userId).in("external_id", externalIds)
      : { data: [] as Array<{ external_id: string }> };
    if ("error" in existing && existing.error) throw new Error(existing.error.message);
    const known = new Set((existing.data ?? []).map((r) => r.external_id));
    const fresh = rows.filter((r) => !r.external_id || !known.has(r.external_id));
    if (!fresh.length) return { inserted: 0, deduped: rows.length };
    const { error, count } = await context.supabase.from("health_samples").insert(fresh, { count: "exact" });
    if (error) throw new Error(error.message);
    return { inserted: count ?? fresh.length, deduped: rows.length - fresh.length };
  });

function localDayRange(timeZone: string | undefined) {
  const zone = timeZone || "UTC";
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(formatter.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const localMidnight = `${parts.year}-${parts.month}-${parts.day}T00:00:00`;
  const guess = new Date(`${localMidnight}Z`);
  const offsetParts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(guess);
  const offset = offsetParts.find((p) => p.type === "timeZoneName")?.value?.replace("GMT", "") || "+00:00";
  const start = new Date(`${localMidnight}${offset}`);
  const nextLocal = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const nextParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(nextLocal).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const nextMidnight = `${nextParts.year}-${nextParts.month}-${nextParts.day}T00:00:00`;
  const nextGuess = new Date(`${nextMidnight}Z`);
  const nextOffset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(nextGuess).find((p) => p.type === "timeZoneName")?.value?.replace("GMT", "") || "+00:00";
  return { start: new Date(`${nextMidnight}${nextOffset}`).getTime() > start.getTime() ? start : guess, end: new Date(`${nextMidnight}${nextOffset}`) };
}

export const listHealthToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ timeZone: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const range = localDayRange(data.timeZone);
    const { data: rows, error } = await context.supabase
      .from("health_samples")
      .select("type, value, ts, source, source_id, external_id")
      .gte("ts", new Date(range.start).toISOString())
      .lt("ts", range.end.toISOString())
      .order("ts", { ascending: false })
      .limit(10000);
    if (error) throw new Error(error.message);
    const values = rows ?? [];
    const sum = (t: string) => values.filter((r) => r.type === t).reduce((s, r) => s + Number(r.value), 0);
    const latest = (t: string) => values.find((r) => r.type === t)?.value ?? null;
    const latestSource = (t: string) => values.find((r) => r.type === t)?.source ?? null;
    return {
      steps: Math.round(sum("steps")),
      kcalActive: Math.round(sum("kcal_active")),
      kcalTotal: Math.round(sum("kcal_total")),
      distanceM: Math.round(sum("distance_m")),
      sleepMin: Math.round(sum("sleep_min")),
      exerciseMin: Math.round(sum("exercise_duration_min")),
      heartRate: latest("heart_rate"),
      restingHeartRate: latest("resting_heart_rate"),
      weightKg: latest("weight_kg"),
      oxygenSaturation: latest("oxygen_saturation"),
      temperatureC: latest("temperature_c"),
      cadenceRpm: latest("cadence_rpm"),
      powerW: latest("power_w"),
      sources: Object.fromEntries(["steps", "kcal_active", "kcal_total", "distance_m", "sleep_min", "exercise_duration_min", "heart_rate", "resting_heart_rate", "weight_kg"].map((t) => [t, latestSource(t)])),
      lastSource: values[0]?.source ?? null,
      lastTs: values[0]?.ts ?? null,
      count: values.length,
    };
  });
