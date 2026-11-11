import { useCallback, useEffect, useState } from "react";

export type DomainRecord<T> = { version: 1; updatedAt: string; mutationId: string; value: T };

const WRITE_EVENT = "pace.domain.write";
const LOCAL_WRITE_EVENT = "pace.local.write";
const REMOTE_WRITE_EVENT = "pace.remote.write";
const STORAGE_PREFIX = "pace.domain.";

function storageKey(domain: string) { return `${STORAGE_PREFIX}${domain}`; }
function mutationId() { if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID(); return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function compareRecords<T>(a: DomainRecord<T>, b: DomainRecord<T>) { const time = a.updatedAt.localeCompare(b.updatedAt); if (time !== 0) return time; return a.mutationId.localeCompare(b.mutationId); }
function unwrapDomainValue(value: unknown, maxDepth = 8): unknown { let current = value; for (let depth = 0; depth < maxDepth; depth++) { if (!current || typeof current !== "object" || Array.isArray(current)) return current; const candidate = current as Record<string, unknown>; if (candidate.version !== 1 || typeof candidate.updatedAt !== "string" || typeof candidate.mutationId !== "string" || !("value" in candidate)) return current; current = candidate.value; } return current; }
export function sanitizeNutritionItems(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [day, rawList] of Object.entries(value as Record<string, unknown>)) {
    // Keep all valid entries, including identical repeated foods. Silent
    // deduplication or truncation would discard legitimate user meal records.
    output[day] = Array.isArray(rawList) ? rawList : [];
  }
  return output;
}
type NutritionTotals = { kcal: number; p: number; c: number; f: number };
function recomputeNutritionTotals(value: unknown): Record<string, NutritionTotals> { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; const totals: Record<string, NutritionTotals> = {}; for (const [day, rawList] of Object.entries(value as Record<string, unknown>)) { const list = Array.isArray(rawList) ? rawList : []; totals[day] = list.reduce<NutritionTotals>((a, raw) => { const x = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}; return { kcal: a.kcal + Number(x.kcal ?? 0), p: a.p + Number(x.p ?? 0), c: a.c + Number(x.c ?? 0), f: a.f + Number(x.f ?? 0) }; }, { kcal: 0, p: 0, c: 0, f: 0 }); } return totals; }
function unwrapNutritionValue(value: unknown) { return unwrapDomainValue(value); }
export function readDomain<T>(domain: string, fallback: T): DomainRecord<T> { if (typeof window === "undefined") return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "server", value: fallback }; try { const raw = localStorage.getItem(storageKey(domain)); if (raw) { const parsed = JSON.parse(raw) as Partial<DomainRecord<T>>; if (parsed.version === 1 && typeof parsed.updatedAt === "string" && typeof parsed.mutationId === "string" && "value" in parsed) { const unwrapped = unwrapDomainValue(parsed.value); return { version: 1, updatedAt: parsed.updatedAt, mutationId: parsed.mutationId, value: (domain === "nutrition.items" ? sanitizeNutritionItems(unwrapped) : unwrapped) as T }; } } const legacyRaw = localStorage.getItem(`pace.${domain}`); if (legacyRaw !== null) { try { const value = JSON.parse(legacyRaw) as T; return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "legacy-import", value: domain === "nutrition.items" ? sanitizeNutritionItems(unwrapNutritionValue(value)) as T : unwrapDomainValue(value) as T }; } catch {} } } catch {} return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "empty", value: fallback }; }
export function writeDomain<T>(domain: string, value: T): DomainRecord<T> { const safeValue = domain === "nutrition.items" ? sanitizeNutritionItems(unwrapNutritionValue(value)) as T : unwrapDomainValue(value) as T; const record: DomainRecord<T> = { version: 1, updatedAt: new Date().toISOString(), mutationId: mutationId(), value: safeValue }; if (typeof window !== "undefined") { try { localStorage.setItem(storageKey(domain), JSON.stringify(record)); localStorage.setItem(`pace.${domain}`, JSON.stringify(safeValue)); window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain, record } })); window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key: `pace.${domain}`, value: safeValue, updatedAt: record.updatedAt, mutationId: record.mutationId } })); if (domain === "nutrition.items") { const totals = recomputeNutritionTotals(safeValue); const totalsRecord: DomainRecord<typeof totals> = { version: 1, updatedAt: record.updatedAt, mutationId: mutationId(), value: totals }; localStorage.setItem(storageKey("nutrition.totals"), JSON.stringify(totalsRecord)); localStorage.setItem("pace.nutrition.totals", JSON.stringify(totals)); window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain: "nutrition.totals", record: totalsRecord } })); window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key: "pace.nutrition.totals", value: totals, updatedAt: totalsRecord.updatedAt, mutationId: totalsRecord.mutationId } })); } } catch {} } return record; }
export function useDomainState<T>(domain: string, fallback: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [record, setRecord] = useState<DomainRecord<T>>(() => readDomain(domain, fallback));
  useEffect(() => {
    const hydrate = () => {
      const next = readDomain(domain, fallback);
      setRecord((current) => {
        return compareRecords(next, current) > 0 ? next : current;
      });
    };
    hydrate();
    const onRemote = () => hydrate();
    window.addEventListener(REMOTE_WRITE_EVENT, onRemote);
    window.addEventListener(WRITE_EVENT, onRemote);
    return () => {
      window.removeEventListener(REMOTE_WRITE_EVENT, onRemote);
      window.removeEventListener(WRITE_EVENT, onRemote);
    };
  }, [domain]);
 useEffect(() => { const onWrite = (event: Event) => { const detail = (event as CustomEvent<{ domain: string; record: DomainRecord<T> }>).detail; if (!detail || detail.domain !== domain) return; setRecord((current) => { if (compareRecords(detail.record, current) <= 0) return current; return { version: 1, updatedAt: detail.record.updatedAt, mutationId: detail.record.mutationId, value: (domain === "nutrition.items" ? sanitizeNutritionItems(unwrapDomainValue(detail.record.value)) : unwrapDomainValue(detail.record.value)) as T }; }); }; const onRemoteWrite = (event: Event) => { const detail = (event as CustomEvent<{ key: string; value: T }>).detail; if (!detail || (detail.key !== `pace.${domain}` && detail.key !== `pace.domain.${domain}`)) return; const next = readDomain<T>(domain, fallback); setRecord((current) => { if (compareRecords(next, current) <= 0) return current; return domain === "nutrition.items" ? { ...next, value: sanitizeNutritionItems(next.value) as T } : next; }); }; window.addEventListener(WRITE_EVENT, onWrite); window.addEventListener(REMOTE_WRITE_EVENT, onRemoteWrite); return () => { window.removeEventListener(WRITE_EVENT, onWrite); window.removeEventListener(REMOTE_WRITE_EVENT, onRemoteWrite); }; }, [domain]); const set = useCallback((next: T | ((previous: T) => T)) => { setRecord((current) => { const value = typeof next === "function" ? (next as (previous: T) => T)(current.value) : next; return writeDomain(domain, value); }); }, [domain]); return [record.value, set]; }
