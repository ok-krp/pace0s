import { useEffect, useState, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listEncryptedHealthSamples } from "@/lib/health.functions";
import { decryptHealthPayload } from "@/lib/health.crypto";
import { migrateLegacyHealthSamplesToE2ee } from "@/lib/health.migration";
import { backfillHealthE2eeDedupeHashes } from "@/lib/health.dedupe.backfill";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

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
  id: string;
  ciphertext: string;
  nonce: string;
  algorithm: "AES-256-GCM";
  key_version: number;
  created_at: string;
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
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
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
  const encryptedRecordsRef = useRef(new Map<string, EncryptedHealthRecord>());
  const decryptedSamplesRef = useRef(new Map<string, HealthSample>());
  const refreshRunningRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setData(EMPTY);
      return;
    }

    if (refreshRunningRef.current) return;
    refreshRunningRef.current = true;
    setLoading(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const migrationKey = `pace-health-e2ee-migrated:${user.id}`;
      const migrationAttemptsKey = `pace-health-e2ee-migration-attempts:${user.id}`;
      if (localStorage.getItem(migrationKey) !== "1") {
        let migrationAttempts = 0;
        try {
          migrationAttempts = Number(sessionStorage.getItem(migrationAttemptsKey) ?? "0");
        } catch {
          migrationAttempts = 0;
        }

        if (migrationAttempts < 2) {
          try {
            try {
              sessionStorage.setItem(migrationAttemptsKey, String(migrationAttempts + 1));
            } catch {
              // Session storage is best-effort; migration failure must never block E2EE reads.
            }

            const migration = await migrateLegacyHealthSamplesToE2ee();
            localStorage.setItem(migrationKey, "1");
            if (migration.deleted > 0) {
              window.dispatchEvent(new Event("pace.health.changed"));
            }
          } catch {
            // Legacy migration is best-effort. Continue loading already-encrypted health data.
          }
        }
      }

      const dedupeBackfillKey = `pace-health-e2ee-dedupe-backfilled:${user.id}`;
      const dedupeBackfillAttemptsKey = `pace-health-e2ee-dedupe-backfill-attempts:${user.id}`;
      if (localStorage.getItem(dedupeBackfillKey) !== "1") {
        let backfillAttempts = 0;
        try {
          backfillAttempts = Number(sessionStorage.getItem(dedupeBackfillAttemptsKey) ?? "0");
        } catch {
          backfillAttempts = 0;
        }
        if (backfillAttempts < 2) {
          try {
            try {
              sessionStorage.setItem(dedupeBackfillAttemptsKey, String(backfillAttempts + 1));
            } catch {
              // Session storage is best-effort; a failed marker must not block health reads.
            }
            const backfill = await backfillHealthE2eeDedupeHashes();
            if (backfill.skipped === 0) localStorage.setItem(dedupeBackfillKey, "1");
          } catch (error) {
            console.warn("health E2EE dedupe backfill deferred", error);
          }
        }
      }

      const { start: dayStart, next: dayEnd } = localDayBounds(timeZone);

      const response = await fetchEncrypted({
        data: {
          limit: 10000,
          since: dayStart.toISOString(),
          until: dayEnd.toISOString(),
        },
      });
      const records = response.records as EncryptedHealthRecord[];
      encryptedRecordsRef.current = new Map(records.map((record) => [record.id, record]));
      decryptedSamplesRef.current = new Map();

      for (const record of encryptedRecordsRef.current.values()) {
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
            decryptedSamplesRef.current.set(record.id, payload as HealthSample);
          }
        } catch (error) {
          console.warn("Skipping undecryptable health record", error);
        }
      }

      setData(aggregateHealthSamples([...decryptedSamplesRef.current.values()], timeZone));
    } catch (error) {
      console.error("health refresh", error);
      setData(EMPTY);
    } finally {
      setLoading(false);
      refreshRunningRef.current = false;
    }
  }, [user, fetchEncrypted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("pace.health.changed", handler);
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    if (!user) {
      return () => {
        window.removeEventListener("pace.health.changed", handler);
        window.removeEventListener("online", onOnline);
      };
    }

    const channelName = `pace-health-e2ee-${user.id}`;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const subscribeRealtime = async () => {
      const existing = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (existing) {
        await supabase.removeChannel(existing);
      }
      if (cancelled) return;

      channel = supabase.channel(channelName);
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "health_samples_e2ee",
          filter: `user_id=eq.${user.id}`,
          select: ["id", "ciphertext", "nonce", "algorithm", "key_version", "created_at"],
        },
        async (payload) => {
          const eventType = payload.eventType;
          const record = payload.new as Partial<EncryptedHealthRecord>;
          if (eventType === "DELETE") {
            const deletedId = (payload.old as { id?: string })?.id;
            if (deletedId) {
              encryptedRecordsRef.current.delete(deletedId);
              decryptedSamplesRef.current.delete(deletedId);
            }
          } else if (
            typeof record?.id === "string" &&
            typeof record?.created_at === "string" &&
            typeof record?.ciphertext === "string" &&
            typeof record?.nonce === "string" &&
            record.algorithm === "AES-256-GCM" &&
            Number.isInteger(record.key_version)
          ) {
            const nextRecord = record as EncryptedHealthRecord;
            encryptedRecordsRef.current.set(nextRecord.id, nextRecord);
            try {
              const decrypted = await decryptHealthPayload(nextRecord.ciphertext, nextRecord.nonce, nextRecord.key_version);
              if (
                decrypted &&
                typeof decrypted === "object" &&
                "ts" in decrypted &&
                "type" in decrypted &&
                "value" in decrypted &&
                typeof (decrypted as HealthSample).ts === "string" &&
                typeof (decrypted as HealthSample).type === "string" &&
                typeof (decrypted as HealthSample).value === "number"
              ) {
                decryptedSamplesRef.current.set(nextRecord.id, decrypted as HealthSample);
              } else {
                decryptedSamplesRef.current.delete(nextRecord.id);
              }
            } catch (error) {
              decryptedSamplesRef.current.delete(nextRecord.id);
              console.warn("Skipping undecryptable health realtime record", error);
            }
          } else {
            return;
          }

          setData(aggregateHealthSamples([...decryptedSamplesRef.current.values()], timeZone));
        },
      );
      void channel.subscribe();
    };

    void subscribeRealtime();

    return () => {
      cancelled = true;
      window.removeEventListener("pace.health.changed", handler);
      window.removeEventListener("online", onOnline);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refresh, user]);

  return { data, loading, refresh };
}
