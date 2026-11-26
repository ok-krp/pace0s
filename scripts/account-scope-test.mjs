import assert from "node:assert/strict";
import { switchLocalAccountScope } from "../src/lib/account-scope.ts";

class MemoryStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#values.has(String(key)) ? this.#values.get(String(key)) : null;
  }

  setItem(key, value) {
    const name = String(key);
    const serialized = String(value);
    this.#values.set(name, serialized);
    Object.defineProperty(this, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: serialized,
    });
  }

  removeItem(key) {
    const name = String(key);
    this.#values.delete(name);
    delete this[name];
  }

  clear() {
    for (const key of [...this.#values.keys()]) this.removeItem(key);
  }
}

const storage = new MemoryStorage();
const events = [];
globalThis.localStorage = storage;
globalThis.window = {
  dispatchEvent(event) {
    events.push(event.type);
    return true;
  },
};

const readJson = (key) => {
  const raw = storage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
};

try {
  const legacyNutrition = {
    "2026-11-11": [
      {
        id: "1731340800000000",
        name: "Repas manuel historique",
        meal: "Déjeuner",
        kcal: 620,
        p: 32,
        c: 74,
        f: 18,
      },
    ],
  };
  const legacyQueue = [
    {
      key: "pace.nutrition.items",
      value: legacyNutrition,
      operation: "upsert",
      queuedAt: "2026-11-11T20:00:00.000Z",
    },
  ];
  storage.setItem("pace.nutrition.items", JSON.stringify(legacyNutrition));
  storage.setItem("lt.sport.history", JSON.stringify({ old: true }));
  storage.setItem("pace.__sync_queue", JSON.stringify(legacyQueue));
  storage.setItem("pace.__sync_meta", JSON.stringify({ "pace.nutrition.items": "2026-11-11T20:00:00.000Z" }));
  storage.setItem("pace.__sync_conflicts", JSON.stringify([]));
  storage.setItem("pace.__sync_device_id", "device-local");

  assert.equal(switchLocalAccountScope("user-a"), true);
  assert.equal(storage.getItem("pace.__account_scope"), "user-a");
  assert.deepEqual(readJson("pace.nutrition.items"), legacyNutrition);
  assert.deepEqual(readJson("lt.sport.history"), { old: true });
  assert.deepEqual(
    readJson("pace.__sync_queue:account:user-a"),
    legacyQueue,
  );
  assert.deepEqual(
    readJson("pace.__sync_meta:account:user-a"),
    { "pace.nutrition.items": "2026-11-11T20:00:00.000Z" },
  );
  assert.equal(storage.getItem("pace.__sync_queue"), null);
  assert.equal(storage.getItem("pace.__sync_meta"), null);
  assert.equal(storage.getItem("pace.__sync_conflicts"), null);
  assert.equal(storage.getItem("pace.__sync_device_id"), "device-local");

  // A switches to B. A's manual entries are saved, while B starts with a
  // separate empty workspace and cannot see A's local state.
  storage.setItem("pace.nutrition.items", JSON.stringify({
    "2026-11-11": [{ id: "meal-a", name: "Repas A", kcal: 500 }],
  }));
  storage.setItem("pace.domain.sport.sessions", JSON.stringify({
    version: 1,
    updatedAt: "2026-11-11T20:10:00.000Z",
    mutationId: "session-a",
    value: [{ id: "session-a" }],
  }));

  assert.equal(switchLocalAccountScope("user-b"), true);
  assert.equal(storage.getItem("pace.__account_scope"), "user-b");
  assert.equal(storage.getItem("pace.nutrition.items"), null);
  assert.equal(storage.getItem("pace.domain.sport.sessions"), null);
  assert.deepEqual(
    readJson("pace.__account_data:user-a")["pace.nutrition.items"],
    JSON.stringify({
      "2026-11-11": [{ id: "meal-a", name: "Repas A", kcal: 500 }],
    }),
  );
  assert.deepEqual(
    readJson("pace.__sync_queue:account:user-a"),
    legacyQueue,
  );

  storage.setItem("pace.nutrition.items", JSON.stringify({
    "2026-11-11": [{ id: "meal-b", name: "Repas B", kcal: 700 }],
  }));
  assert.equal(switchLocalAccountScope(null), true);
  assert.equal(storage.getItem("pace.nutrition.items"), null);
  assert.equal(storage.getItem("pace.__account_scope"), "__guest__");

  storage.setItem("pace.nutrition.items", JSON.stringify({
    "2026-11-11": [{ id: "meal-guest", name: "Repas invité", kcal: 100 }],
  }));
  assert.equal(switchLocalAccountScope("user-a"), true);
  assert.deepEqual(
    readJson("pace.nutrition.items"),
    { "2026-11-11": [{ id: "meal-a", name: "Repas A", kcal: 500 }] },
  );
  assert.equal(storage.getItem("pace.__account_scope"), "user-a");

  assert.equal(switchLocalAccountScope("user-b"), true);
  assert.deepEqual(
    readJson("pace.nutrition.items"),
    { "2026-11-11": [{ id: "meal-b", name: "Repas B", kcal: 700 }] },
  );
  assert.equal(storage.getItem("pace.__account_scope"), "user-b");

  // A corrupt target snapshot must not erase the currently active account.
  storage.setItem("pace.__account_data:user-c", "{not-json");
  storage.setItem("pace.nutrition.items", JSON.stringify({
    "2026-11-11": [{ id: "meal-b-current", name: "Repas B actuel" }],
  }));
  assert.throws(() => switchLocalAccountScope("user-c"));
  assert.equal(storage.getItem("pace.__account_scope"), "user-b");
  assert.deepEqual(readJson("pace.nutrition.items"), {
    "2026-11-11": [{ id: "meal-b-current", name: "Repas B actuel" }],
  });

  assert.ok(events.filter((event) => event === "pace.remote.write").length >= 5);
  process.stdout.write("account-scope-test: all account isolation and recovery checks passed\n");
} catch (error) {
  console.error("account-scope-test failed:", error);
  process.exitCode = 1;
}
