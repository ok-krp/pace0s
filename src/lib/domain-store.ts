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

    // Progressive migration: preserve the existing Pace key and promote it on first write.
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
      // Keep the old key during the progressive migration as a recovery copy.
      localStorage.setItem(`pace.${domain}`, JSON.stringify(value));
      // There is exactly one local->cloud sync contract: pace.local.write.
      // The former domain outbox was never consumed by the active sync engine
      // and could leave stale duplicate state behind.
      window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain, record } }));
      window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key: `pace.${domain}`, value } }));
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
