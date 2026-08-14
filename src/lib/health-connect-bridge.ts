import { insertHealthSamples } from "@/lib/health.functions";

export type HealthConnectPayload = {
  source: string;
  timezone?: string;
  samples: Array<{
    ts: string;
    type: string;
    value: number;
    source: string;
    source_id?: string;
    external_id?: string;
    start?: string;
    end?: string;
    exerciseType?: number;
  }>;
};

type NativeHealthConnect = { requestSync: () => void; _receive?: (json: string) => void };
declare global { interface Window { PaceHealthConnect?: NativeHealthConnect } }

const SUPPORTED = new Set([
  "steps", "kcal_active", "kcal_total", "heart_rate", "resting_heart_rate",
  "distance_m", "sleep_min", "exercise_duration_min", "weight_kg",
  "oxygen_saturation", "temperature_c", "cadence_rpm", "power_w",
]);

let initialized = false;

export function isNativeHealthConnectAvailable() {
  return typeof window !== "undefined" && typeof window.PaceHealthConnect?.requestSync === "function";
}

export function initHealthConnectBridge(onSync?: (result: { inserted: number; source: string } | { error: string }) => void) {
  if (typeof window === "undefined" || initialized) return () => {};
  initialized = true;
  const native = window.PaceHealthConnect;
  if (!native) return () => { initialized = false; };

  native._receive = async (json: string) => {
    try {
      const envelope = JSON.parse(json) as { ok: boolean; payload?: HealthConnectPayload; error?: string };
      if (!envelope.ok || !envelope.payload) { onSync?.({ error: envelope.error ?? "Health Connect indisponible" }); return; }
      const samples = envelope.payload.samples.filter((s) => SUPPORTED.has(s.type) && Number.isFinite(s.value) && !!s.ts).map((s) => ({
        ts: s.ts,
        type: s.type as "steps" | "kcal_active" | "kcal_total" | "heart_rate" | "resting_heart_rate" | "distance_m" | "sleep_min" | "exercise_duration_min" | "weight_kg" | "oxygen_saturation" | "temperature_c" | "cadence_rpm" | "power_w",
        value: s.value,
        source: s.source || "health_connect",
        source_id: s.source,
        external_id: s.external_id,
        metadata: { timezone: envelope.payload?.timezone, start: s.start, end: s.end, exerciseType: s.exerciseType },
      }));

      let inserted = 0;
      for (let i = 0; i < samples.length; i += 500) {
        const chunk = samples.slice(i, i + 500);
        if (!chunk.length) continue;
        const result = await insertHealthSamples({ data: { samples: chunk } });
        inserted += result.inserted;
      }
      window.dispatchEvent(new CustomEvent("pace.health.changed", { detail: { source: "health_connect", inserted } }));
      onSync?.({ inserted, source: "health_connect" });
    } catch (error) { onSync?.({ error: error instanceof Error ? error.message : String(error) }); }
  };
  return () => { if (window.PaceHealthConnect) window.PaceHealthConnect._receive = undefined; initialized = false; };
}

export function requestHealthConnectSync() {
  if (!isNativeHealthConnectAvailable()) return false;
  window.PaceHealthConnect!.requestSync();
  return true;
}
