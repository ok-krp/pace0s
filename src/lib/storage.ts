import { useEffect, useState, useCallback } from "react";

const OLD_PREFIX = "lt.";
const NEW_PREFIX = "pace.";
const MIGRATION_FLAG = "pace.__migrated_lt";

/**
 * Migration unique : le projet s'appelait auparavant "LifeTracker" et stockait
 * toutes ses données sous des clés lt.*. Copie chaque ancienne clé vers son
 * équivalent pace.* (sans écraser une valeur pace.* déjà présente), puis
 * supprime l'ancienne. Exécutée une seule fois, avant toute lecture — aucune
 * donnée existante n'est perdue lors du renommage.
 */
function migrateLegacyKeys() {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return;
    const legacyKeys = Object.keys(localStorage).filter((k) => k.startsWith(OLD_PREFIX));
    for (const oldKey of legacyKeys) {
      const newKey = NEW_PREFIX + oldKey.slice(OLD_PREFIX.length);
      const value = localStorage.getItem(oldKey);
      if (value !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value);
      }
      localStorage.removeItem(oldKey);
    }
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {
    // Stockage indisponible (navigation privée, quota...) — on retentera au prochain chargement.
  }
}
migrateLegacyKeys();

/**
 * Événement émis à chaque écriture locale d'une clé lt.* — écouté par le moteur
 * de sync cloud pour pousser automatiquement (voir use-cloud-sync-engine.tsx).
 */
const LOCAL_WRITE_EVENT = "pace.local.write";
/**
 * Événement émis quand une donnée arrive depuis le Cloud (autre appareil) —
 * toutes les instances de useLocalState sur cette clé se mettent à jour en
 * direct, sans rechargement de page.
 */
const REMOTE_WRITE_EVENT = "pace.remote.write";

export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw));
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

  // Réception d'une mise à jour distante (autre appareil / autre onglet) : on adopte
  // la valeur reçue directement dans l'état React, en temps réel.
  useEffect(() => {
    const onRemote = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; value: unknown }>).detail;
      if (!detail || detail.key !== key) return;
      setValue(detail.value as T);
    };
    window.addEventListener(REMOTE_WRITE_EVENT, onRemote);
    return () => window.removeEventListener(REMOTE_WRITE_EVENT, onRemote);
  }, [key]);

  const set = useCallback((v: T | ((p: T) => T)) => {
    setValue((prev) => (typeof v === "function" ? (v as (p: T) => T)(prev) : v));
  }, []);

  return [value, set];
}

/** Utilisé uniquement par le moteur de sync cloud pour appliquer une valeur distante. */
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
