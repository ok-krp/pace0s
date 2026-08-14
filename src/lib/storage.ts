import { useEffect, useState, useCallback } from "react";

const OLD_PREFIX = "lt.";
const NEW_PREFIX = "pace.";
const MIGRATION_FLAG = "pace.__migrated_lt";

/**
 * Migration idempotente des anciennes clés LifeTracker (lt.*) vers PaceOS (pace.*).
 *
 * La migration copie d'abord la valeur vers la nouvelle clé sans jamais écraser une
 * valeur pace.* déjà existante, puis retire l'ancienne clé. Un vrai 0 est conservé
 * comme 0 et n'est jamais converti en null/valeur vide.
 */
function migrateLegacyKeys() {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return;

    const legacyKeys = Object.keys(localStorage).filter((key) => key.startsWith(OLD_PREFIX));
    for (const oldKey of legacyKeys) {
      const newKey = NEW_PREFIX + oldKey.slice(OLD_PREFIX.length);
      const value = localStorage.getItem(oldKey);

      // Une donnée PaceOS déjà présente est prioritaire : aucune écriture destructive.
      if (value !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value);
      }

      localStorage.removeItem(oldKey);
    }

    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {
    // Stockage indisponible/quota atteint : la migration sera retentée au prochain chargement.
  }
}
migrateLegacyKeys();

/** Émis après chaque écriture locale afin que le moteur de synchronisation puisse réagir. */
const LOCAL_WRITE_EVENT = "pace.local.write";
/** Émis lorsqu'une valeur distante est appliquée au stockage local. */
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

/** Utilisé par le moteur de synchronisation cloud pour appliquer une valeur distante. */
export function applyRemoteWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
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

export const todayKey = () => new Date().toISOString().slice(0, 10);

export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

export function fmtDay(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
}
