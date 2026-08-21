import { useEffect, useState, useCallback, useRef } from "react";

const OLD_PREFIX = "lt.";
const NEW_PREFIX = "pace.";
const MIGRATION_FLAG = "pace.__migrated_lt";
const WATER_RECOVERY_FLAG = "pace.__water_recovery_v3";

function migrateLegacyKeys() {
  if (typeof window === "undefined") return;
  try {
    const legacyKeys = Object.keys(localStorage).filter((key) => key.startsWith(OLD_PREFIX));
    for (const oldKey of legacyKeys) {
      const newKey = NEW_PREFIX + oldKey.slice(OLD_PREFIX.length);
      const value = localStorage.getItem(oldKey);
      if (value === null) continue;
      const current = localStorage.getItem(newKey);
      if (current === null) {
        try { localStorage.setItem(newKey, value); } catch { continue; }
        continue;
      }
      try {
        const legacyValue: unknown = JSON.parse(value);
        const currentValue: unknown = JSON.parse(current);
        const legacyIsObject = legacyValue && typeof legacyValue === "object" && !Array.isArray(legacyValue);
        const currentIsObject = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue);
        if (legacyIsObject && currentIsObject) {
          const legacyEntries = Object.entries(legacyValue as Record<string, unknown>);
          const currentEntries = Object.entries(currentValue as Record<string, unknown>);
          if (legacyEntries.length > 0 && currentEntries.length === 0) localStorage.setItem(newKey, JSON.stringify(legacyValue));
          else if (legacyEntries.length > 0) localStorage.setItem(newKey, JSON.stringify({ ...(legacyValue as Record<string, unknown>), ...(currentValue as Record<string, unknown>) }));
        } else if ((Array.isArray(currentValue) && currentValue.length === 0) || currentValue == null || current === "") localStorage.setItem(newKey, value);
      } catch {}
    }
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {}
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
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(n) && n >= 0 && target[day] == null) target[day] = n;
      }
    }
    localStorage.setItem(targetKey, JSON.stringify(target));
    localStorage.setItem(WATER_RECOVERY_FLAG, "1");
  } catch {}
}

recoverLegacyWaterKeys();
migrateLegacyKeys();

const LOCAL_WRITE_EVENT = "pace.local.write";
const REMOTE_WRITE_EVENT = "pace.remote.write";
const DOMAIN_WRITE_EVENT = "pace.domain.write";

type StoredOverloadRow = { id?: string; date?: string; weight?: number; reps?: number; sets?: number; source?: string };
type StoredOverload = Record<string, StoredOverloadRow[]>;
type StoredExercise = { id: string; defaultWeight?: number; defaultReps?: number; defaultSets?: number; [key: string]: unknown };
type StoredProgramItem = { exerciseId: string; weight?: number; reps: number; sets: number; [key: string]: unknown };
type StoredProgram = { id: string; items: StoredProgramItem[]; [key: string]: unknown };
type DomainRecord = { version: 1; updatedAt: string; mutationId: string; value: unknown };

function syncDebugEnabled() {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  try { return localStorage.getItem("pace.__sync_debug") === "1"; } catch { return false; }
}

function syncDebug(event: string, detail: Record<string, unknown>) {
  if (!syncDebugEnabled()) return;
  console.debug(`[${event}]`, detail);
}

function syncLatestOverloadRowsToTraining(value: unknown) {
  if (typeof window === "undefined" || !value || typeof value !== "object" || Array.isArray(value)) return;
  try {
    const overload = value as StoredOverload;
    const rawExercises = localStorage.getItem("pace.sport.exercises");
    const rawPrograms = localStorage.getItem("pace.sport.programs");
    if (!rawExercises && !rawPrograms) return;
    const exercises = rawExercises ? JSON.parse(rawExercises) as StoredExercise[] : [];
    const programs = rawPrograms ? JSON.parse(rawPrograms) as StoredProgram[] : [];
    let exercisesChanged = false;
    let programsChanged = false;
    for (const [exerciseId, rows] of Object.entries(overload)) {
      if (!Array.isArray(rows)) continue;
      const latest = rows.find((row) => row?.source === "manual") ?? null;
      if (!latest) continue;
      const weight = Number(latest.weight ?? 0);
      const reps = Number(latest.reps ?? 0);
      const sets = Number(latest.sets ?? 0);
      if (![weight, reps, sets].every(Number.isFinite)) continue;
      for (let i = 0; i < exercises.length; i++) {
        if (exercises[i].id !== exerciseId) continue;
        if (exercises[i].defaultWeight === weight && exercises[i].defaultReps === reps && exercises[i].defaultSets === sets) continue;
        exercises[i] = { ...exercises[i], defaultWeight: weight, defaultReps: reps, defaultSets: sets };
        exercisesChanged = true;
      }
      for (let i = 0; i < programs.length; i++) {
        const program = programs[i];
        let itemsChanged = false;
        const items = program.items.map((item) => {
          if (item.exerciseId !== exerciseId) return item;
          if (item.weight === weight && item.reps === reps && item.sets === sets) return item;
          itemsChanged = true;
          return { ...item, weight, reps, sets };
        });
        if (itemsChanged) {
          programs[i] = { ...program, items };
          programsChanged = true;
        }
      }
    }
    if (exercisesChanged) {
      localStorage.setItem("pace.sport.exercises", JSON.stringify(exercises));
      window.dispatchEvent(new CustomEvent(REMOTE_WRITE_EVENT, { detail: { key: "pace.sport.exercises", value: exercises } }));
    }
    if (programsChanged) {
      localStorage.setItem("pace.sport.programs", JSON.stringify(programs));
      window.dispatchEvent(new CustomEvent(REMOTE_WRITE_EVENT, { detail: { key: "pace.sport.programs", value: programs } }));
    }
  } catch {}
}

function applyRemoteDomainRecord(domain: string, value: unknown, updatedAt: string) {
  if (typeof window === "undefined" || !domain || !updatedAt) return false;
  try {
    const key = `pace.domain.${domain}`;
    const existingRaw = localStorage.getItem(key);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as Partial<DomainRecord>;
        if (existing.version === 1 && typeof existing.updatedAt === "string" && Date.parse(existing.updatedAt) > Date.parse(updatedAt)) return false;
      } catch {}
    }
    const record: DomainRecord = { version: 1, updatedAt, mutationId: `remote-${updatedAt}`, value };
    localStorage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const valueRef = useRef<T>(initial);
  const hydratedRef = useRef(false);
  const suppressPersistRef = useRef(false);

  useEffect(() => {
    hydratedRef.current = false;
    suppressPersistRef.current = false;
  }, [key]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        valueRef.current = parsed;
        setValue(parsed);
      }
    } catch {}
    setLoaded(true);
  }, [key]);

  useEffect(() => { valueRef.current = value; }, [value]);

  useEffect(() => {
    if (!loaded) return;
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    if (suppressPersistRef.current) {
      // A REMOTE_WRITE changes React state but is not a user mutation.
      suppressPersistRef.current = false;
      syncDebug("REMOTE_APPLIED", { key });
      return;
    }
    try {
      const serialized = JSON.stringify(value);
      const previous = localStorage.getItem(key);
      if (previous === serialized) return;
      localStorage.setItem(key, serialized);
      if (key === "pace.sport.overload") syncLatestOverloadRowsToTraining(value);
      syncDebug("LOCAL_WRITE", { key, timestamp: new Date().toISOString(), source: "user" });
      window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key, value } }));
    } catch {}
  }, [key, value, loaded]);

  useEffect(() => {
    const onRemote = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; value: unknown }>).detail;
      if (!detail || detail.key !== key) return;
      suppressPersistRef.current = true;
      valueRef.current = detail.value as T;
      syncDebug("REMOTE_RECEIVE", { key, source: "remote" });
      setValue(detail.value as T);
    };
    window.addEventListener(REMOTE_WRITE_EVENT, onRemote);
    return () => window.removeEventListener(REMOTE_WRITE_EVENT, onRemote);
  }, [key]);

  const set = useCallback((next: T | ((p: T) => T)) => {
    const resolved = typeof next === "function" ? (next as (p: T) => T)(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
  }, []);

  return [value, set];
}

export function applyRemoteWrite(key: string, value: unknown, updatedAt?: string) {
  let valueChanged = true;
  try {
    const serialized = JSON.stringify(value);
    const previous = localStorage.getItem(key);
    valueChanged = previous !== serialized;
    if (valueChanged) localStorage.setItem(key, serialized);
  } catch {}

  if (updatedAt) {
    if (key.startsWith("pace.domain.")) {
      const domain = key.slice("pace.domain.".length);
      const metadataChanged = applyRemoteDomainRecord(domain, value, updatedAt);
      if (!metadataChanged && !valueChanged) return;
    } else if (key.startsWith(NEW_PREFIX)) {
      const domain = key.slice(NEW_PREFIX.length);
      const metadataChanged = applyRemoteDomainRecord(domain, value, updatedAt);
      if (!metadataChanged && !valueChanged) return;
    }
  }

  if (!valueChanged) return;
  syncDebug("REMOTE_RECEIVE", { key, updatedAt, source: "remote" });
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
