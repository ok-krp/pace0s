import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidFoodLogInsertRow,
  isValidNutritionItemInput,
  isValidFoodLogOutboxEntry,
  nutritionFoodLogOutboxKey,
  queueFoodLogInsert,
  deferFoodLogOutboxInsert,
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
  assert.throws(() => nutritionFoodLogOutboxKey("not-a-supabase-uuid"));
});

test("rejects normalized invalid calendar and timezone timestamps in outbox entries", () => {
  const entry = {
    id,
    queuedAt,
    row,
  };
  assert.equal(isValidFoodLogOutboxEntry(entry, userId), true);
  assert.equal(
    isValidFoodLogOutboxEntry({
      ...entry,
      queuedAt: "2026-02-30T12:00:00.000Z",
    }, userId),
    false,
  );
  assert.equal(
    isValidFoodLogOutboxEntry({
      ...entry,
      queuedAt: "2026-11-06T12:00:00.000+14:01",
    }, userId),
    false,
  );
  assert.equal(
    isValidFoodLogOutboxEntry({
      ...entry,
      queuedAt: "2026-11-06T12:00:00.1234567Z",
    }, userId),
    false,
  );
});

test("validates canonical food_log rows with optional null nutrient values", () => {
  assert.equal(isValidFoodLogInsertRow(row, userId), true);
    assert.equal(isValidFoodLogInsertRow({ ...row, log_date: "2000-02-29" }, userId), true);
    assert.equal(isValidFoodLogInsertRow({ ...row, log_date: "1900-02-29" }, userId), false);
    assert.equal(isValidFoodLogInsertRow({ ...row, log_date: "0001-01-01" }, userId), true);
  assert.equal(isValidFoodLogInsertRow({ ...row, health_score: "green" }, userId), true);
  assert.equal(isValidFoodLogInsertRow({ ...row, health_score: "unknown" }, userId), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, user_id: "other-user" }, userId), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, user_id: "not-a-uuid" }), false);
  const cyclicMeta: Record<string, unknown> = {};
  cyclicMeta.self = cyclicMeta;
  assert.equal(isValidFoodLogInsertRow({ ...row, meta: cyclicMeta }), false);
  let deeplyNested: unknown = "leaf";
  for (let index = 0; index < 22; index++) deeplyNested = { child: deeplyNested };
  assert.equal(isValidFoodLogInsertRow({ ...row, meta: { deeplyNested } }), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, log_date: "2026-02-30" }, userId), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, kcal: Number.NaN }, userId), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, source: "unknown" }, userId), false);
  assert.equal(isValidFoodLogInsertRow({ ...row, unexpected: Number.POSITIVE_INFINITY }, userId), false);
  const cyclicRow = { ...row } as FoodLogInsertRow & { unexpected?: unknown };
  cyclicRow.unexpected = cyclicRow;
  assert.equal(isValidFoodLogInsertRow(cyclicRow, userId), false);

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

test("keeps a foreign-account row when queueing a same-ID local replacement", () => {
  const foreignUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const foreignRow = { ...row, user_id: foreignUserId, name: "Account B food" };
  const foreignQueue = queueFoodLogInsert([], foreignRow, queuedAt);
  const mixed = queueFoodLogInsert(
    foreignQueue,
    { ...row, name: "Account A food" },
    "2026-11-06T12:01:00.000Z",
  );

  assert.equal(mixed.length, 2);
  assert.equal(readValidFoodLogOutbox(mixed, userId).length, 1);
  assert.equal(readValidFoodLogOutbox(mixed, foreignUserId).length, 1);
  assert.equal(
    readValidFoodLogOutbox(mixed, foreignUserId)[0].row.name,
    "Account B food",
  );
});

test("does not acknowledge a different row payload even if the millisecond timestamp collides", () => {
  const original = queueFoodLogInsert([], row, queuedAt);
  const oldOperation = readValidFoodLogOutbox(original, userId, Date.parse(queuedAt))[0];
  const replacement = queueFoodLogInsert(
    original,
    { ...row, name: "Riz remplacé dans la même milliseconde" },
    queuedAt,
  );

  const afterOldAck = removeFoodLogOutboxInsert(replacement, oldOperation);
  assert.equal(readValidFoodLogOutbox(afterOldAck, userId, Date.parse(queuedAt)).length, 1);
  assert.equal(
    readValidFoodLogOutbox(afterOldAck, userId, Date.parse(queuedAt))[0].row.name,
    "Riz remplacé dans la même milliseconde",
  );
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


test("preserves a malformed queue container when a different in-flight row is acknowledged", () => {
  const malformed = { previousVersion: ["keep this payload"] };
  assert.deepEqual(removeFoodLogOutboxInsert(malformed, {
    id,
    queuedAt,
    row,
  }), [malformed]);
  assert.deepEqual(deferFoodLogOutboxInsert(malformed, {
    id,
    queuedAt,
    row,
  }, Date.parse(queuedAt)), [malformed]);
});

test("does not discard a malformed outbox container during a new insert", () => {
  assert.throws(
    () => queueFoodLogInsert({ pending: "do not discard" }, row, queuedAt),
    /Malformed Nutrition outbox container/,
  );
});


test("backs off failed rows and makes them due only after the retry time", () => {
  const queued = queueFoodLogInsert([], row, queuedAt);
  const firstOperation = readValidFoodLogOutbox(
    queued,
    userId,
    Date.parse(queuedAt),
  )[0];
  const failedAt = Date.parse(queuedAt);
  const deferred = deferFoodLogOutboxInsert(queued, firstOperation, failedAt);
  const stored = deferred[0] as Record<string, unknown>;

  assert.equal(stored.attempts, 1);
  assert.equal(stored.nextAttemptAt, new Date(failedAt + 60_000).toISOString());
  assert.equal(readValidFoodLogOutbox(deferred, userId, failedAt + 59_999).length, 0);
  assert.equal(readValidFoodLogOutbox(deferred, userId, failedAt + 60_000).length, 1);
});

test("a stale in-flight acknowledgement cannot remove an operation already deferred for retry", () => {
  const queued = queueFoodLogInsert([], row, queuedAt);
  const oldOperation = readValidFoodLogOutbox(
    queued,
    userId,
    Date.parse(queuedAt),
  )[0];
  const deferred = deferFoodLogOutboxInsert(
    queued,
    oldOperation,
    Date.parse(queuedAt),
  );
  const afterOldAck = removeFoodLogOutboxInsert(deferred, oldOperation);

  assert.equal(afterOldAck.length, 1);
  assert.equal((afterOldAck[0] as Record<string, unknown>).attempts, 1);
});


test("validates manual Nutrition input before any persistence side effect", () => {
  const valid = {
    name: "  Riz  ",
    meal: "Déjeuner",
    kcal: 220,
    p: 4,
    c: 48,
    f: 1,
    qty: 1,
    fiber: 0,
    sodium: 0,
  };
  assert.equal(isValidNutritionItemInput(valid), true);
  assert.equal(isValidNutritionItemInput({ ...valid, kcal: Number.NaN }), false);
  assert.equal(isValidNutritionItemInput({ ...valid, p: -1 }), false);
  assert.equal(isValidNutritionItemInput({ ...valid, fiber: Number.POSITIVE_INFINITY }), false);
  assert.equal(isValidNutritionItemInput({ ...valid, qty: 0 }), false);
  assert.equal(isValidNutritionItemInput({ ...valid, name: " " }), false);
  assert.equal(isValidNutritionItemInput({ ...valid, meal: "" }), false);
});
