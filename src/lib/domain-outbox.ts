export type DomainOutboxEntry<T = unknown> = {
  id: string;
  domain: string;
  value: T;
  createdAt: string;
  attempts: number;
};

const STORAGE_KEY = "pace.domain.outbox";
const EVENT = "pace.domain.outbox.changed";

function id() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function read<T>(): DomainOutboxEntry<T>[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write<T>(entries: DomainOutboxEntry<T>[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function enqueueDomainWrite<T>(domain: string, value: T) {
  const entries = read<T>();
  const entry: DomainOutboxEntry<T> = {
    id: id(),
    domain,
    value,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  write([...entries, entry]);
  return entry;
}

export function peekDomainOutbox<T>(): DomainOutboxEntry<T>[] {
  return read<T>();
}

export function removeDomainOutboxEntry(idToRemove: string) {
  write(read().filter((entry) => entry.id !== idToRemove));
}

export function markDomainOutboxAttempt(idToUpdate: string) {
  write(read().map((entry) => entry.id === idToUpdate ? { ...entry, attempts: entry.attempts + 1 } : entry));
}

export function subscribeDomainOutbox(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
