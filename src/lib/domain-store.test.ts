import test from "node:test";
import assert from "node:assert/strict";
import { applyRemoteDomainWrite } from "./domain-store.ts";

const values = new Map<string, string>();
const localStorageMock = {
  get length() { return values.size; },
  clear() { values.clear(); },
  getItem(key: string) { return values.get(key) ?? null; },
  key(index: number) { return [...values.keys()][index] ?? null; },
  removeItem(key: string) { values.delete(key); },
  setItem(key: string, value: string) { values.set(key, String(value)); },
};

const eventTarget = new EventTarget();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageMock });
Object.defineProperty(globalThis, "window", { configurable: true, value: eventTarget });

test("remote domain writes update the versioned record and legacy key without enqueueing an echo", () => {
  values.clear();
  const domainEvents: Event[] = [];
  const localWrites: Event[] = [];
  eventTarget.addEventListener("pace.domain.write", (event) => domainEvents.push(event));
  eventTarget.addEventListener("pace.local.write", (event) => localWrites.push(event));

  const updatedAt = "2026-10-31T12:34:56.000Z";
  const nutrition = { "2026-10-31": [{ id: "remote-item", name: "Oats", kcal: 150 }] };
  applyRemoteDomainWrite("nutrition.items", nutrition, updatedAt);

  const record = JSON.parse(values.get("pace.domain.nutrition.items") ?? "null");
  assert.equal(record.version, 1);
  assert.equal(record.updatedAt, updatedAt);
  assert.equal(record.mutationId, `remote:${updatedAt}`);
  assert.deepEqual(record.value, nutrition);
  assert.deepEqual(JSON.parse(values.get("pace.nutrition.items") ?? "null"), nutrition);
  assert.equal(domainEvents.length, 1);
  assert.equal(localWrites.length, 0);
});

test("remote domain writes reject invalid timestamps in favour of a valid local timestamp", () => {
  values.clear();
  applyRemoteDomainWrite("nutrition.totals", { "2026-10-31": { kcal: 150 } }, "not-a-timestamp");

  const record = JSON.parse(values.get("pace.domain.nutrition.totals") ?? "null");
  assert.equal(Number.isFinite(Date.parse(record.updatedAt)), true);
  assert.match(record.mutationId, /^remote:/);
});
