import { useCallback, useEffect, useState } from "react";

export type DomainRecord<T> = {
  version: 1;
  updatedAt: string;
  mutationId: string;
  value: T;
};

const WRITE_EVENT = "pace.domain.write";
const LOCAL_WRITE_EVENT = "pace.local.write";
const STORAGE_PREFIX = "pace.domain.";

function storageKey(domain: string) {
  return `${STORAGE_PREFIX}${domain}`;
}

function mutationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function compareRecords<T>(a: DomainRecord<T>, b: DomainRecord<T>) {
  const time = a.updatedAt.localeCompare(b.updatedAt);
  if (time !== 0) return time;
  return a.mutationId.localeCompare(b.mutationId);
}

type NutritionTotals = { kcal: number; p: number; c: number; f: number };

function recomputeNutritionTotals(value: unknown): Record<string, NutritionTotals> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const totals: Record<string, NutritionTotals> = {};
  for (const [day, rawList] of Object.entries(value as Record<string, unknown>)) {
    const list = Array.isArray(rawList) ? rawList : [];
    totals[day] = list.reduce<NutritionTotals>((a, raw) => {
      const x = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return {
        kcal: a.kcal + Number(x.kcal ?? 0),
        p: a.p + Number(x.p ?? 0),
        c: a.c + Number(x.c ?? 0),
        f: a.f + Number(x.f ?? 0),
      };
    }, { kcal: 0, p: 0, c: 0, f: 0 });
  }
  return totals;
}

export function readDomain<T>(domain: string, fallback: T): DomainRecord<T> {
  if (typeof window === "undefined") {
    return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "server", value: fallback };
  }

  try {
    const raw = localStorage.getItem(storageKey(domain));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DomainRecord<T>>;
      if (parsed.version === 1 && typeof parsed.updatedAt === "string" && typeof parsed.mutationId === "string" && "value" in parsed) {
        return parsed as DomainRecord<T>;
      }
    }

    const legacyRaw = localStorage.getItem(`pace.${domain}`);
    if (legacyRaw !== null) {
      try {
        return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "legacy-import", value: JSON.parse(legacyRaw) as T };
      } catch {}
    }
  } catch {}

  return { version: 1, updatedAt: new Date(0).toISOString(), mutationId: "empty", value: fallback };
}

export function writeDomain<T>(domain: string, value: T): DomainRecord<T> {
  const record: DomainRecord<T> = {
    version: 1,
    updatedAt: new Date().toISOString(),
    mutationId: mutationId(),
    value,
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(storageKey(domain), JSON.stringify(record));
      localStorage.setItem(`pace.${domain}`, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain, record } }));
      window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key: `pace.${domain}`, value } }));

      // nutrition.items is the source of truth for the local-first nutrition domain.
      // Keep its derived totals synchronized when legacy screens write items directly.
      if (domain === "nutrition.items") {
        const totals = recomputeNutritionTotals(value);
        const totalsRecord: DomainRecord<typeof totals> = {
          version: 1,
          updatedAt: new Date().toISOString(),
          mutationId: mutationId(),
          value: totals,
        };
        localStorage.setItem(storageKey("nutrition.totals"), JSON.stringify(totalsRecord));
        localStorage.setItem("pace.nutrition.totals", JSON.stringify(totals));
        window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain: "nutrition.totals", record: totalsRecord } }));
        window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key: "pace.nutrition.totals", value: totals } }));
      }
    } catch {
      // The in-memory state remains usable; the central sync queue retries later.
    }
  }

  return record;
}

export function useDomainState<T>(domain: string, fallback: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [record, setRecord] = useState<DomainRecord<T>>(() => readDomain(domain, fallback));

  useEffect(() => {
    setRecord(readDomain(domain, fallback));
  }, [domain]);

  useEffect(() => {
    const onWrite = (event: Event) => {
      const detail = (event as CustomEvent<{ domain: string; record: DomainRecord<T> }>).detail;
      if (!detail || detail.domain !== domain) return;
      setRecord((current) => {
        if (compareRecords(detail.record, current) <= 0) return current;
        return detail.record;
      });
    };
    window.addEventListener(WRITE_EVENT, onWrite);
    return () => window.removeEventListener(WRITE_EVENT, onWrite);
  }, [domain]);

  const set = useCallback((next: T | ((previous: T) => T)) => {
    setRecord((current) => {
      const value = typeof next === "function" ? (next as (previous: T) => T)(current.value) : next;
      return writeDomain(domain, value);
    });
  }, [domain]);

  return [record.value, set];
}
