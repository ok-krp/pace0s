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

/** Server sync has already validated account scope and server timestamps. */
export function shouldApplyDomainRecord<T>(
  incoming: DomainRecord<T>,
  current: DomainRecord<T>,
  remote = false,
): boolean {
  return remote || compareRecords(incoming, current) > 0;
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

/**
 * Apply a server-confirmed domain value without enqueueing it as a new local
 * mutation. This keeps domain-backed readers in sync with the legacy key while
 * avoiding a Realtime echo/write loop.
 */
export function applyRemoteDomainWrite<T>(domain: string, value: T, updatedAt?: string): void {
  if (typeof window === "undefined") return;
  const timestamp = updatedAt && Number.isFinite(Date.parse(updatedAt))
    ? updatedAt
    : new Date().toISOString();
  const record: DomainRecord<T> = {
    version: 1,
    updatedAt: timestamp,
    mutationId: `remote:${timestamp}`,
    value,
  };
  try {
    localStorage.setItem(storageKey(domain), JSON.stringify(record));
    localStorage.setItem(`pace.${domain}`, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain, record, remote: true } }));
  } catch {
    // The legacy storage event remains the fallback if domain storage is full.
  }
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
      window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: { domain, record } }));
      // Reuse the existing cloud-sync event contract so domain writes are queued
      // by the current sync engine instead of creating a second sync mechanism.
      window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key: `pace.${domain}`, value } }));
    } catch {
      // The in-memory state remains usable; the outbox can retry later.
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
      const detail = (event as CustomEvent<{ domain: string; record: DomainRecord<T>; remote?: boolean }>).detail;
      if (!detail || detail.domain !== domain) return;
      // The sync engine has already compared the server timestamp with this
      // account's checkpoint and excluded locally queued keys. An accepted
      // remote value is authoritative even if this device's wall clock was
      // ahead when the local version was created.
      setRecord((current) =>
        shouldApplyDomainRecord(detail.record, current, detail.remote) ? detail.record : current,
      );
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
