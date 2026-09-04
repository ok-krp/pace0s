import { useCallback, useEffect, useState } from "react";

export type DomainRecord<T> = { version: 1; updatedAt: string; mutationId: string; value: T };

const WRITE_EVENT = "pace.domain.write";
const LOCAL_WRITE_EVENT = "pace.local.write";
const REMOTE_WRITE_EVENT = "pace.remote.write";
const STORAGE_PREFIX = "pace.domain.";
const MAX_NUTRITION_ITEMS_PER_DAY = 500;
const MAX_IDENTICAL_NUTRITION_ITEMS_PER_DAY = 3;

function storageKey(domain: string) { return `${STORAGE_PREFIX}${domain}`; }
function mutationId() { if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID(); return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function compareRecords<T>(a: DomainRecord<T>, b: DomainRecord<T>) { const time = a.updatedAt.localeCompare(b.updatedAt); if (time !== 0) return time; return a.mutationId.localeCompare(b.mutationId); }
function nutritionFingerprint(item: unknown) { if (!item || typeof item !== "object" || Array.isArray(item)) return "invalid"; const x = item as Record<string, unknown>; return JSON.stringify({ name: x.name ?? "", meal: x.meal ?? "", kcal: Number(x.kcal ?? 0), p: Number(x.p ?? 0), c: Number(x.c ?? 0), f: Number(x.f ?? 0), fiber: Number(x.fiber ?? 0), sugar: Number(x.sugar ?? 0), sodium: Number(x.sodium ?? 0), qty: Number(x.qty ?? 1) }); }
export function sanitizeNutritionItems(value: unknown): unknown { if (!value || typeof value !== "object" || Array.isArray(value)) return value; const source = value as Record<string, unknown>; const output: Record<string, unknown> = {}; for (const [day, rawList] of Object.entries(source)) { if (!Array.isArray(rawList)) { output[day] = []; continue; } const counts = new Map<string, number>(); const cleaned: unknown[] = []; for (const item of rawList) { const fingerprint = nutritionFingerprint(item); const count = counts.get(fingerprint) ?? 0; if (count >= MAX_IDENTICAL_NUTRITION_ITEMS_PER_DAY) continue; counts.set(fingerprint, count + 1); cleaned.push(item); } output[day] = cleaned.length > MAX_NUTRITION_ITEMS_PER_DAY ? cleaned.slice(-MAX_NUTRITION_ITEMS_PER_DAY) : cleaned; } return output; }
type NutritionTotals = { kcal: number; p: number; c: number; f: number };
function recomputeNutritionTotals(value: unknown): Record<string, NutritionTotals> { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; const totals: Record<string, NutritionTotals> = {}; for (const [day, rawList] of Object.entries(value as Record<string, unknown>)) { const list = Array.isArray(rawList) ? rawList : []; totals[day] = list.reduce<NutritionTotals>((a, raw) => { const x = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}; return { kcal: a.kcal + Number(x.kcal ?? 0), p: a.p + Number(x.p ?? 0), c: a.c + Number(x.c ?? 0), f: a.f + Number(x.f ?? 0) }; }, { kcal: 0, p: 0, c: 0, f: 0 }); } return totals; }

/** Merge only genuinely new Nutrition items. This prevents an older/partial
 * remote payload from making an existing meal disappear while still allowing
 * newer remote snapshots (including deletions) to win when they contain no new IDs. */
function mergeNutritionValues(localValue: unknown, incomingValue: unknown) {
  if (!localValue || typeof localValue !== "object" || Array.isArray(localValue) || !incomingValue || typeof incomingValue !== "object" || Array.isArray(incomingValue)) return null;
  const local = localValue as Record<string, unknown>; const incoming = incomingValue as Record<string, unknown>; const merged: Record<string, unknown> = { ...local }; let hasNewItem = false;
  for (const [day, rawIncoming] of Object.entries(incoming)) {
    if (!Array.isArray(rawIncoming)) { merged[day] = rawIncoming; continue; }
    const rawLocal = Array.isArray(local[day]) ? local[day] as unknown[] : [];
    const localIds = new Set(rawLocal.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : "").filter(Boolean));
    const incomingIds = rawIncoming.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : "").filter(Boolean);
    if (incomingIds.some((id) => !localIds.has(id))) hasNewItem = true;
    const byId = new Map<string, unknown>(); rawLocal.forEach((item) => { const id = item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : ""; if (id) byId.set(id, item); });
    const output = [...rawLocal];
    for (const item of rawIncoming) {
      const id = item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : "";
      if (id && byId.has(id)) { const index = output.findIndex((x) => x && typeof x === "object" && String((x as Record<string, unknown>).id ?? "") === id); if (index >= 0) output[index] = item; }
      else { output.push(item); if (id) byId.set(id, item); }
    }
    merged[day] = output;
  }
  return hasNewItem ? sanitizeNutritionItems(merged) : null;
}

export function readDomain<T>(domain: string, fallback: T): DomainRecord<T> {
  if (typeof window === "undefined") return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "server", value: fallback };
  try { const raw = localStorage.getItem(storageKey(domain)); if (raw) { const parsed = JSON.parse(raw) as Partial<DomainRecord<T>>; if (parsed.version === 1 && typeof parsed.updatedAt === "string" && typeof parsed.mutationId === "string" && "value" in parsed) { if (domain === "nutrition.items") parsed.value = sanitizeNutritionItems(parsed.value) as T; return parsed as DomainRecord<T>; } } const legacyRaw = localStorage.getItem(`pace.${domain}`); if (legacyRaw !== null) { try { const value = JSON.parse(legacyRaw) as T; return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "legacy-import", value: domain === "nutrition.items" ? sanitizeNutritionItems(value) as T : value }; } catch {} } } catch {}
  return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "empty", value: fallback };
}

export function writeDomain<T>(domain: string, value: T): DomainRecord<T> {
  const safeValue = domain === "nutrition.items" ? sanitizeNutritionItems(value) as T : value; const record: DomainRecord<T> = { version: 1, updatedAt: new Date().toISOString(), mutationId: mutationId(), value: safeValue };
  if (typeof window !== "undefined") { try { localStorage.setItem(storageKey(domain), JSON.stringify(record)); localStorage.setItem(`pace.${domain}`, JSON.stringify(safeValue)); window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain, record } })); window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key: `pace.${domain}`, value: safeValue, updatedAt: record.updatedAt, mutationId: record.mutationId } })); if (domain === "nutrition.items") { const totals = recomputeNutritionTotals(safeValue); const totalsRecord: DomainRecord<typeof totals> = { version: 1, updatedAt: record.updatedAt, mutationId: mutationId(), value: totals }; localStorage.setItem(storageKey("nutrition.totals"), JSON.stringify(totalsRecord)); localStorage.setItem("pace.nutrition.totals", JSON.stringify(totals)); window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain: "nutrition.totals", record: totalsRecord } })); window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key: "pace.nutrition.totals", value: totals, updatedAt: totalsRecord.updatedAt, mutationId: totalsRecord.mutationId } })); } } catch {} }
  return record;
}

export function useDomainState<T>(domain: string, fallback: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [record, setRecord] = useState<DomainRecord<T>>(() => readDomain(domain, fallback));
  useEffect(() => { setRecord(readDomain(domain, fallback)); }, [domain]);
  useEffect(() => {
    const onWrite = (event: Event) => {
      const detail = (event as CustomEvent<{ domain: string; record: DomainRecord<T> }>).detail; if (!detail || detail.domain !== domain) return;
      setRecord((current) => { if (domain === "nutrition.items") { const merged = mergeNutritionValues(current.value, detail.record.value); if (merged) return { ...detail.record, value: merged as T }; } return compareRecords(detail.record, current) <= 0 ? current : detail.record; });
    };
    const onRemoteWrite = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: T }>).detail; if (!detail || (detail.key !== `pace.${domain}` && detail.key !== `pace.domain.${domain}`)) return; const next = readDomain<T>(domain, fallback);
      setRecord((current) => { if (domain === "nutrition.items") { const merged = mergeNutritionValues(current.value, next.value); if (merged) return { ...next, value: merged as T }; } return compareRecords(next, current) <= 0 ? current : next; });
    };
    window.addEventListener(WRITE_EVENT, onWrite); window.addEventListener(REMOTE_WRITE_EVENT, onRemoteWrite); return () => { window.removeEventListener(WRITE_EVENT, onWrite); window.removeEventListener(REMOTE_WRITE_EVENT, onRemoteWrite); };
  }, [domain]);
  const set = useCallback((next: T | ((previous: T) => T)) => { setRecord((current) => { const value = typeof next === "function" ? (next as (previous: T) => T)(current.value) : next; return writeDomain(domain, value); }); }, [domain]);
  return [record.value, set];
}
