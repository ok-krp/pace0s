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
    ts: z.string(), type: SampleType, value: z.number().finite(), source: z.string().max(128).default("manual"),
    source_id: z.string().max(128).optional(), external_id: z.string().max(256).optional(), metadata: z.record(z.unknown()).optional(),
  })).min(1).max(5000),
});

function isMissingProvenanceColumn(error: { message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return /column .*?(source_id|external_id|metadata).* does not exist/i.test(message);
}

export const insertHealthSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => insertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const healthTable = context.supabase.from("health_samples") as any;
    const rows = data.samples.map((s) => ({ ...s, user_id: context.userId, metadata: s.metadata ?? {} }));
    const externalIds = rows.map((r) => r.external_id).filter((v): v is string => !!v);
    let provenanceSupported = true;
    let known = new Set<string>();

    if (externalIds.length) {
      const existing = await healthTable.select("external_id").eq("user_id", context.userId).in("external_id", externalIds);
      if (existing.error) {
        if (!isMissingProvenanceColumn(existing.error)) throw new Error(existing.error.message);
        provenanceSupported = false;
      } else {
        known = new Set((existing.data ?? []).map((r: { external_id: string }) => r.external_id));
      }
    }

    const fresh = provenanceSupported
      ? rows.filter((r) => !r.external_id || !known.has(r.external_id))
      : rows;
    if (!fresh.length) return { inserted: 0, deduped: rows.length };

    let result = await healthTable.insert(fresh, { count: "exact" });
    if (result.error && isMissingProvenanceColumn(result.error)) {
      const legacyRows = fresh.map(({ source_id: _sourceId, external_id: _externalId, metadata: _metadata, ...row }) => row);
      result = await healthTable.insert(legacyRows, { count: "exact" });
    }
    if (result.error) throw new Error(result.error.message);
    return { inserted: result.count ?? fresh.length, deduped: rows.length - fresh.length };
  });

function localDayRange(timeZone: string | undefined) {
  const zone = timeZone || "UTC";
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const localMidnight = `${parts.year}-${parts.month}-${parts.day}T00:00:00`;
  const guess = new Date(`${localMidnight}Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value?.replace("GMT", "") || "+00:00";
  const start = new Date(`${localMidnight}${offset}`);
  const nextLocal = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const nextParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(nextLocal).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const nextMidnight = `${nextParts.year}-${nextParts.month}-${nextParts.day}T00:00:00`;
  const nextGuess = new Date(`${nextMidnight}Z`);
  const nextOffset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(nextGuess).find((p) => p.type === "timeZoneName")?.value?.replace("GMT", "") || "+00:00";
  return { start, end: new Date(`${nextMidnight}${nextOffset}`) };
}

export const listHealthToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ timeZone: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const range = localDayRange(data.timeZone);
    const healthTable = context.supabase.from("health_samples") as any;

    // Read only columns guaranteed by the current schema. Provenance columns are optional
    // and must never be allowed to make the Watch/Dashboard endpoint crash when a migration
    // has not yet been applied in Supabase.
    const result = await healthTable
      .select("type, value, ts, source")
      .gte("ts", range.start.toISOString())
      .lt("ts", range.end.toISOString())
      .order("ts", { ascending: false })
      .limit(10000);

    if (result.error) throw new Error(result.error.message);

    const values = result.data ?? [];
    const sum = (t: string) => values.filter((r: any) => r.type === t).reduce((s: number, r: any) => s + Number(r.value), 0);
    const latest = (t: string) => values.find((r: any) => r.type === t)?.value ?? null;
    const latestSource = (t: string) => values.find((r: any) => r.type === t)?.source ?? null;
    return {
      steps: Math.round(sum("steps")), kcalActive: Math.round(sum("kcal_active")), kcalTotal: Math.round(sum("kcal_total")), distanceM: Math.round(sum("distance_m")),
      sleepMin: Math.round(sum("sleep_min")), exerciseMin: Math.round(sum("exercise_duration_min")), heartRate: latest("heart_rate"), restingHeartRate: latest("resting_heart_rate"),
      weightKg: latest("weight_kg"), oxygenSaturation: latest("oxygen_saturation"), temperatureC: latest("temperature_c"), cadenceRpm: latest("cadence_rpm"), powerW: latest("power_w"),
      sources: Object.fromEntries(["steps", "kcal_active", "kcal_total", "distance_m", "sleep_min", "exercise_duration_min", "heart_rate", "resting_heart_rate", "weight_kg"].map((t) => [t, latestSource(t)])),
      lastSource: values[0]?.source ?? null, lastTs: values[0]?.ts ?? null, count: values.length,
    };
  });
