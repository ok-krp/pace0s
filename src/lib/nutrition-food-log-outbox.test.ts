import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidFoodLogInsertRow,
  isValidFoodLogOutboxEntry,
  nutritionFoodLogOutboxKey,
  queueFoodLogInsert,
  readValidFoodLogOutbox,
  removeFoodLogOutboxInsert,
  type FoodLogInsertRow,
} from "./nutrition-food-log-outbox.ts";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = "00000000-0000-4000-8000-000000000001";
const row: FoodLogInsertRow = {
  id,
  user_id: userId,
  log_date: "2026-11-06",
  meal: "Déjeuner",
  name: "Riz",
  kcal: 220,
  protein_g: 4,
  carbs_g: 48,
  fat_g: 1,
  fiber_g: null,
  sugar_g: 0,
  sodium_mg: 15,
  source: "manual",
  meta: { client: "pace_web", missing_nutrients: ["fiber_g"] },
};
const queuedAt = "2026-11-06T12:00:00.000Z";

test("scopes the local retry key to one account", () => {
  const alice = nutritionFoodLogOutboxKey(userId);
  const bob = nutritionFoodLogOutboxKey("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.notEqual(alice, bob);
  assert.match(alice, /pace\.__sync_food_log_outbox:/);
  assert.throws(() => nutritionFoodLogOutboxKey("  "));
});

test("validates canonical food_log rows with optional null nutrient values", () => {
  assert.equal(isValidFoodLogInsertRow(row, userId), true);
  assert.equal(isValidFoodLogInsertRow({ ...row, user_id: "other-user" }, userId), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, log_date: "2026-02-30" }, userId), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, kcal: Number.NaN }, userId), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, source: "unknown" }, userId), false);
});

test("queues one retry per stable row UUID without replacing unrelated entries", () => {
  const first = queueFoodLogInsert([], row, queuedAt);
  const other = { ...row, id: "00000000-0000-4000-8000-000000000002", name: "Pomme" };
  const both = queueFoodLogInsert(first, other, "2026-11-06T12:01:00.000Z");
  const replacement = queueFoodLogInsert(
    both,
    { ...row, name: "Riz corrigé", kcal: 240 },
    "2026-11-06T12:02:00.000Z",
  );

  assert.equal(replacement.length, 2);
  const entries = readValidFoodLogOutbox(replacement, userId);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.id === id)?.row.name, "Riz corrigé");
  assert.equal(entries.find((entry) => entry.id === id)?.queuedAt, "2026-11-06T12:02:00.000Z");
});

test("does not acknowledge a newer replacement after an older request completes", () => {
  const initial = queueFoodLogInsert([], row, queuedAt);
  const oldOperation = readValidFoodLogOutbox(initial, userId)[0];
  const replacement = queueFoodLogInsert(
    initial,
    { ...row, name: "Riz remplacé" },
    "2026-11-06T12:01:00.000Z",
  );

  const afterOldAck = removeFoodLogOutboxInsert(replacement, oldOperation);
  assert.equal(readValidFoodLogOutbox(afterOldAck, userId).length, 1);
  assert.equal(readValidFoodLogOutbox(afterOldAck, userId)[0].row.name, "Riz remplacé");
});

test("filters malformed and foreign-account operations before replay", () => {
  const valid = queueFoodLogInsert([], row, queuedAt);
  const mixed = [
    ...valid,
    { id, queuedAt, row: { ...row, user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } },
    { id: "bad", queuedAt: "invalid", row },
  ];
  assert.equal(readValidFoodLogOutbox(mixed, userId).length, 1);
  assert.equal(isValidFoodLogOutboxEntry(mixed[0], userId), true);
  assert.equal(isValidFoodLogOutboxEntry(mixed[1], userId), false);
});
