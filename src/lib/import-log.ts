/**
 * Journal d'import + déduplication locale.
 * - `lt.ble.seen`: rolling hash set des dernières mesures ingérées (ts|type|source|value).
 * - `lt.import.log`: historique horodaté (source, count, errors) affiché dans les réglages.
 */

const SEEN_KEY = "pace.ble.seen";
const LOG_KEY = "pace.import.log";
const SEEN_MAX = 5000;
const LOG_MAX = 100;

export type ImportEntry = {
  ts: string;
  source: string;
  inserted: number;
  skipped: number;
  error?: string;
};

function safeReadArr<T>(k: string): T[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(k) ?? "[]") as T[]; } catch { return []; }
}
function safeWrite(k: string, v: unknown) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

function hashSample(s: { ts: string; type: string; source: string; value: number }): string {
  return `${s.ts}|${s.type}|${s.source}|${s.value}`;
}

/** Retourne uniquement les échantillons non déjà vus, et mémorise les nouveaux. */
export function dedupeSamples<T extends { ts: string; type: string; source: string; value: number }>(samples: T[]): { fresh: T[]; skipped: number } {
  const seen = new Set(safeReadArr<string>(SEEN_KEY));
  const fresh: T[] = [];
  let skipped = 0;
  for (const s of samples) {
    const h = hashSample(s);
    if (seen.has(h)) { skipped++; continue; }
    seen.add(h);
    fresh.push(s);
  }
  // rolling window
  let arr = Array.from(seen);
  if (arr.length > SEEN_MAX) arr = arr.slice(arr.length - SEEN_MAX);
  safeWrite(SEEN_KEY, arr);
  return { fresh, skipped };
}

export function logImport(entry: Omit<ImportEntry, "ts"> & { ts?: string }) {
  const arr = safeReadArr<ImportEntry>(LOG_KEY);
  arr.unshift({ ts: entry.ts ?? new Date().toISOString(), ...entry });
  safeWrite(LOG_KEY, arr.slice(0, LOG_MAX));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("pace.import.log.changed"));
}

export function readImportLog(): ImportEntry[] {
  return safeReadArr<ImportEntry>(LOG_KEY);
}

export function clearImportLog() {
  safeWrite(LOG_KEY, []);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("pace.import.log.changed"));
}
