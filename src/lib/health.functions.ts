import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TablesInsert } from "@/integrations/supabase/types";

const SampleType = z.enum(["steps", "kcal_active", "kcal_total", "heart_rate", "resting_heart_rate", "distance_m", "sleep_min", "exercise_duration_min", "weight_kg", "oxygen_saturation", "temperature_c", "cadence_rpm", "power_w"]);
const insertSchema = z.object({ samples: z.array(z.object({ ts: z.string(), type: SampleType, value: z.number().finite(), source: z.string().max(128).default("manual"), source_id: z.string().max(128).optional(), external_id: z.string().max(256).optional(), metadata: z.record(z.unknown()).optional() })).min(1).max(5000) });

function isMissingProvenanceColumn(error: { message?: string } | null | undefined) {
  return /column .*?(source_id|external_id|metadata).* does not exist/i.test(error?.message ?? "");
}

export const insertHealthSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => insertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: healthConsent } = await context.supabase
      .from("consent_records")
      .select("granted")
      .eq("consent_type", "health_data")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: cloudConsent } = await context.supabase
      .from("consent_records")
      .select("granted")
      .eq("consent_type", "health_cloud_sync")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (healthConsent?.granted !== true || cloudConsent?.granted !== true) {
      throw new Error("Le consentement santé et la synchronisation cloud doivent être activés.");
    }

    const healthTable = context.supabase.from("health_samples");
    const rows: TablesInsert<"health_samples">[] = data.samples.map((s) => ({ ...s, user_id: context.userId, metadata: s.metadata ?? {} }));
    const externalIds = rows.map((r) => r.external_id).filter((v): v is string => !!v);
    let provenanceSupported = true;
    let known = new Set<string>();

    if (externalIds.length) {
      const existing = await healthTable.select("external_id").eq("user_id", context.userId).in("external_id", externalIds);
      if (existing.error) {
        if (!isMissingProvenanceColumn(existing.error)) {
          console.error("health provenance lookup failed", existing.error);
          throw new Error("Impossible de vérifier les données de santé existantes.");
        }
        provenanceSupported = false;
      } else known = new Set((existing.data ?? []).map((r: { external_id: string }) => r.external_id));
    }

    const fresh = provenanceSupported ? rows.filter((r) => !r.external_id || !known.has(r.external_id)) : rows;
    if (!fresh.length) return { inserted: 0, deduped: rows.length };

    let result = await healthTable.insert(fresh, { count: "exact" });
    if (result.error && isMissingProvenanceColumn(result.error)) {
      const legacyRows = fresh.map(({ source_id: _sourceId, external_id: _externalId, metadata: _metadata, ...row }) => row);
      result = await healthTable.insert(legacyRows, { count: "exact" });
    }
    if (result.error) {
      console.error("health sample insert failed", result.error);
      throw new Error("Impossible d'enregistrer les données de santé.");
    }
    return { inserted: result.count ?? fresh.length, deduped: rows.length - fresh.length };
  });

function localDayRange(timeZone: string | undefined) {
  const zone = timeZone || "UTC";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
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
  .validator((d: unknown) => z.object({ timeZone: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { data: healthConsent } = await context.supabase
      .from("consent_records")
      .select("granted")
      .eq("consent_type", "health_data")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (healthConsent?.granted !== true) {
      return {
        steps: 0, kcalActive: 0, kcalTotal: 0, distanceM: 0, sleepMin: 0, exerciseMin: 0,
        heartRate: null, restingHeartRate: null, weightKg: null, oxygenSaturation: null,
        temperatureC: null, cadenceRpm: null, powerW: null, sources: {}, lastSource: null, lastTs: null, count: 0,
      };
    }

    const range = localDayRange(data.timeZone);
    const healthTable = context.supabase.from("health_samples") as any;
    const result = await healthTable.select("type, value, ts, source").gte("ts", range.start.toISOString()).lt("ts", range.end.toISOString()).order("ts", { ascending: false }).limit(10000);
    if (result.error) {
      console.error("health sample read failed", result.error);
      throw new Error("Impossible de charger les données de santé.");
    }
    const values = result.data ?? [];
    const sum = (type: string) => values.filter((row) => row.type === type).reduce((total, row) => total + Number(row.value), 0);
    const latest = (type: string) => values.find((row) => row.type === type)?.value ?? null;
    const latestSource = (type: string) => values.find((row) => row.type === type)?.source ?? null;
    return {
      steps: Math.round(sum("steps")), kcalActive: Math.round(sum("kcal_active")), kcalTotal: Math.round(sum("kcal_total")), distanceM: Math.round(sum("distance_m")),
      sleepMin: Math.round(sum("sleep_min")), exerciseMin: Math.round(sum("exercise_duration_min")), heartRate: latest("heart_rate"), restingHeartRate: latest("resting_heart_rate"),
      weightKg: latest("weight_kg"), oxygenSaturation: latest("oxygen_saturation"), temperatureC: latest("temperature_c"), cadenceRpm: latest("cadence_rpm"), powerW: latest("power_w"),
      sources: Object.fromEntries(["steps", "kcal_active", "kcal_total", "distance_m", "sleep_min", "exercise_duration_min", "heart_rate", "resting_heart_rate", "weight_kg"].map((t) => [t, latestSource(t)])),
      lastSource: values[0]?.source ?? null, lastTs: values[0]?.ts ?? null, count: values.length,
    };
  });
