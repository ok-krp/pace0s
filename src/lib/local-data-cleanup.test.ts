import test from "node:test";
import assert from "node:assert/strict";
import { clearLocalPaceData, type LocalStorageLike } from "./local-data-cleanup.ts";

class MemoryStorage implements LocalStorageLike {
  private readonly values: Map<string, string>;

  constructor(entries: Array<[string, string]>) {
    this.values = new Map(entries);
  }

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

test("clears Pace keys and preserves unrelated application storage", async () => {
  const storage = new MemoryStorage([
    ["pace.profile.name", '"Pace"'],
    ["pace.privacy.pin.hash", '"local-secret-hash"'],
    ["lt.water", '"legacy-water"'],
    ["lt.nutrition.items", '"legacy-nutrition"'],
    ["other.application.key", '"keep"'],
  ]);

  const result = await clearLocalPaceData(storage, async () => {});

  assert.deepEqual(result, {
    deviceCacheCleared: true,
    localStorageCleared: true,
    errors: [],
  });
  assert.deepEqual(storage.keys(), ["other.application.key"]);
});

test("still clears Pace localStorage when the IndexedDB cache cannot be opened", async () => {
  const storage = new MemoryStorage([
    ["pace.profile.name", '"Pace"'],
    ["pace.wallpaper", '"legacy-data-url"'],
    ["other.application.key", '"keep"'],
  ]);

  const result = await clearLocalPaceData(storage, async () => {
    throw new Error("IndexedDB is unavailable");
  });

  assert.equal(result.deviceCacheCleared, false);
  assert.equal(result.localStorageCleared, true);
  assert.deepEqual(storage.keys(), ["other.application.key"]);
  assert.match(result.errors.join(" "), /IndexedDB: IndexedDB is unavailable/);
});

test("reports a failed localStorage removal without stopping later removals", async () => {
  const removed: string[] = [];
  const storage: LocalStorageLike = {
    get length() { return 3; },
    key(index) {
      return ["pace.first", "pace.blocked", "pace.last"][index] ?? null;
    },
    removeItem(key) {
      if (key === "pace.blocked") throw new Error("permission denied");
      removed.push(key);
    },
  };

  const result = await clearLocalPaceData(storage, async () => {});

  assert.deepEqual(removed, ["pace.first", "pace.last"]);
  assert.equal(result.deviceCacheCleared, true);
  assert.equal(result.localStorageCleared, false);
  assert.match(result.errors.join(" "), /pace.blocked: permission denied/);
});

test("still clears IndexedDB when localStorage itself is inaccessible", async () => {
  let cacheCleared = false;
  const result = await clearLocalPaceData(null, async () => {
    cacheCleared = true;
  });
  assert.equal(cacheCleared, true);
  assert.equal(result.deviceCacheCleared, true);
  assert.equal(result.localStorageCleared, false);
  assert.match(result.errors.join(" "), /localStorage: inaccessible/);
});
