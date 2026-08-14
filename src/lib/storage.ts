import { useEffect, useState, useCallback } from "react";

const OLD_PREFIX = "lt.";
const NEW_PREFIX = "pace.";
const MIGRATION_FLAG = "pace.__migrated_lt";
const WATER_RECOVERY_FLAG = "pace.__water_recovery_v3";

/**
 * Legacy data is copied forward but never deleted automatically.
 * This is intentional: old keys are a recovery source if a later migration
 * produced an empty or incomplete Pace value.
 */
function migrateLegacyKeys() {
  if (typeof window === "undefined") return;
  try {
    const legacyKeys = Object.keys(localStorage).filter((key) => key.startsWith(OLD_PREFIX));
    for (const oldKey of legacyKeys) {
      const newKey = NEW_PREFIX + oldKey.slice(OLD_PREFIX.length);
      const value = localStorage.getItem(oldKey);
      if (value === null) continue;
      if (localStorage.getItem(newKey) === null) {
        try { localStorage.setItem(newKey, value); } catch { continue; }
      }
    }
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {
    // Retry on the next load if storage is unavailable/quota-limited.
  }
}

function recoverLegacyWaterKeys() {
  if (typeof window === "undefined") return;
  try {
    const targetKey = "pace.water";
    let target: Record<string, number> = {};
    try {
      const raw = localStorage.getItem(targetKey);
      if (raw) target = JSON.parse(raw);
    } catch {}

    const candidates = ["lt.water", "lt.water_consumed", "lt.hydration", "pace.water_consumed", "pace.hydration"];
    for (const key of candidates) {
      let candidate: unknown;
      try { candidate = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { continue; }
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      for (const [day, value] of Object.entries(candidate as Record<string, unknown>)) {
        const n = typeof value === "number" ? value : Number(value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(n) && n >= 0 && target[day] == null) {
          target[day] = n;
        }
      }
    }
    localStorage.setItem(targetKey, JSON.stringify(target));
    localStorage.setItem(WATER_RECOVERY_FLAG, "1");
  } catch {}
}

// Recover first, then copy legacy keys. Legacy keys remain available for future recovery.
recoverLegacyWaterKeys();
migrateLegacyKeys();

const LOCAL_WRITE_EVENT = "pace.local.write";
const REMOTE_WRITE_EVENT = "pace.remote.write";

export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key, value } }));
    } catch {}
  }, [key, value, loaded]);

  useEffect(() => {
    const onRemote = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; value: unknown }>).detail;
      if (!detail || detail.key !== key) return;
      setValue(detail.value as T);
    };
    window.addEventListener(REMOTE_WRITE_EVENT, onRemote);
    return () => window.removeEventListener(REMOTE_WRITE_EVENT, onRemote);
  }, [key]);

  const set = useCallback((next: T | ((p: T) => T)) => {
    setValue((prev) => (typeof next === "function" ? (next as (p: T) => T)(prev) : next));
  }, []);

  return [value, set];
}

export function applyRemoteWrite(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  window.dispatchEvent(new CustomEvent(REMOTE_WRITE_EVENT, { detail: { key, value } }));
}

export function onLocalWrite(handler: (key: string, value: unknown) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ key: string; value: unknown }>).detail;
    if (detail) handler(detail.key, detail.value);
  };
  window.addEventListener(LOCAL_WRITE_EVENT, listener);
  return () => window.removeEventListener(LOCAL_WRITE_EVENT, listener);
}

/**
 * Return the current calendar date in the user's local timezone.
 * Do not use toISOString() here: that converts to UTC and can shift a user's
 * local day around midnight, which corrupts daily health/nutrition/calendar keys.
 */
export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`);
  }
  return out;
}

function parseLocalDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return new Date(iso);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function fmtDay(iso: string) {
  const d = parseLocalDate(iso);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
}
