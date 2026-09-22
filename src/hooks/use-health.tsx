import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listEncryptedHealthSamples } from "@/lib/health.functions";
import { decryptHealthPayload } from "@/lib/health.crypto";
import { migrateLegacyHealthSamplesToE2ee } from "@/lib/health.migration";
import { useAuth } from "@/hooks/use-auth";

export type HealthToday = {
  steps: number; kcalActive: number; kcalTotal: number; distanceM: number; sleepMin: number; exerciseMin: number;
  heartRate: number | null; restingHeartRate: number | null; weightKg: number | null; oxygenSaturation: number | null;
  temperatureC: number | null; cadenceRpm: number | null; powerW: number | null; sources: Record<string, string | null>;
  lastSource: string | null; lastTs: string | null; count: number;
};

const EMPTY: HealthToday = {
  steps: 0, kcalActive: 0, kcalTotal: 0, distanceM: 0, sleepMin: 0, exerciseMin: 0,
  heartRate: null, restingHeartRate: null, weightKg: null, oxygenSaturation: null,
  temperatureC: null, cadenceRpm: null, powerW: null, sources: {}, lastSource: null, lastTs: null, count: 0,
};

type HealthSample = {
  ts: string;
  type: string;
  value: number;
  source?: string | null;
};

type EncryptedHealthRecord = {
  ciphertext: string;
  nonce: string;
};

const SAMPLE_TYPES = new Set([
  "steps", "kcal_active", "kcal_total", "heart_rate", "resting_heart_rate",
  "distance_m", "sleep_min", "exercise_duration_min", "weight_kg",
  "oxygen_saturation", "temperature_c", "cadence_rpm", "power_w",
]);

function localDayBounds(timeZone: string) {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const start = new Date(`${localDate}T00:00:00`);
  const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { localDate, start, next };
}

function aggregateHealthSamples(samples: HealthSample[], timeZone: string): HealthToday {
  const { localDate } = localDayBounds(timeZone);
  const today = samples
    .filter((sample) => SAMPLE_TYPES.has(sample.type))
    .filter((sample) => {
      const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(sample.ts));
      return date === localDate;
    })
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

  const sum = (type: string) =>
    today.filter((sample) => sample.type === type).reduce((total, sample) => total + Number(sample.value), 0);
  const latest = (type: string) => today.find((sample) => sample.type === type)?.value ?? null;
  const latestSource = (type: string) => today.find((sample) => sample.type === type)?.source ?? null;

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
    sources: Object.fromEntries(
      ["steps", "kcal_active", "kcal_total", "distance_m", "sleep_min", "exercise_duration_min", "heart_rate", "resting_heart_rate", "weight_kg"]
        .map((type) => [type, latestSource(type)]),
    ),
    lastSource: today[0]?.source ?? null,
    lastTs: today[0]?.ts ?? null,
    count: today.length,
  };
}

export function useHealthToday() {
  const { user } = useAuth();
  const fetchEncrypted = useServerFn(listEncryptedHealthSamples);
  const [data, setData] = useState<HealthToday>(EMPTY);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setData(EMPTY);
      return;
    }

    setLoading(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const migrationKey = `pace-health-e2ee-migrated:${user.id}`;
      if (localStorage.getItem(migrationKey) !== "1") {
        const migration = await migrateLegacyHealthSamplesToE2ee();
        localStorage.setItem(migrationKey, "1");
        if (migration.deleted > 0) window.dispatchEvent(new Event("pace.health.changed"));
      }

      const response = await fetchEncrypted({ data: { limit: 10000 } });
      const records = response.records as EncryptedHealthRecord[];
      const samples: HealthSample[] = [];

      for (const record of records) {
        try {
          if (record.algorithm !== "AES-256-GCM" || !Number.isInteger(record.key_version) || record.key_version < 1) continue;
          const payload = await decryptHealthPayload(record.ciphertext, record.nonce, record.key_version);
          if (
            payload &&
            typeof payload === "object" &&
            "ts" in payload &&
            "type" in payload &&
            "value" in payload &&
            typeof (payload as HealthSample).ts === "string" &&
            typeof (payload as HealthSample).type === "string" &&
            typeof (payload as HealthSample).value === "number"
          ) {
            samples.push(payload as HealthSample);
          }
        } catch (error) {
          console.warn("Skipping undecryptable health record", error);
        }
      }

      setData(aggregateHealthSamples(samples, timeZone));
    } catch (error) {
      console.error("health refresh", error);
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [user, fetchEncrypted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("pace.health.changed", handler);
    return () => window.removeEventListener("pace.health.changed", handler);
  }, [refresh]);

  return { data, loading, refresh };
}
