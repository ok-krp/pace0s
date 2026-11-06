import test from "node:test";
import assert from "node:assert/strict";
import { mapFoodLogRow, mergeCanonicalNutritionItems, fetchAllFoodLogKeysetPages, mergeUnassignedNutritionSnapshots, mayReadGlobalNutritionCache, NUTRITION_CACHE_OWNER_KEY, NUTRITION_UNASSIGNED_BACKUP_KEY, nutritionAccountCacheKeys, queueNutritionTombstone, readActiveNutritionTombstones } from "./nutrition-sync.ts";

const canonical = {
  id: "00000000-0000-4000-8000-000000000001",
  log_date: "2026-11-05",
  meal: "Déjeuner",
  name: "Riz",
  kcal: 220,
  protein_g: 4,
  carbs_g: 48,
  fat_g: 1,
  fiber_g: 2,
  sugar_g: 1,
  sodium_mg: 15,
  meta: null,
};

test("maps canonical food_log rows into the Nutrition UI shape", () => {
  assert.deepEqual(mapFoodLogRow(canonical), {
    id: canonical.id,
    name: "Riz",
    meal: "Déjeuner",
    kcal: 220,
    p: 4,
    c: 48,
    f: 1,
    fiber: 2,
    sugar: 1,
    sodium: 15,
    qty: 1,
    __foodLogCanonical: true,
  });
});

test("does not display stored zeroes for nutrients the user left blank", () => {
  const mapped = mapFoodLogRow({
    ...canonical,
    kcal: 0,
    protein_g: 0,
    carbs_g: 48,
    fat_g: 1,
    meta: { missing_nutrients: ["kcal", "protein_g"] },
  });

  assert.equal(mapped.kcal, 0);
  assert.equal(mapped.p, 0);
  assert.equal(mapped.c, 48);
  assert.equal(mapped.f, 1);
  assert.equal(mapped.__foodLogCanonical, true);
});

test("merges canonical rows without duplicating or losing legacy JSON-only entries", () => {
  const remote = { ...canonical };
  const local = [
    { id: canonical.id, name: "old duplicate", meal: "Déjeuner", kcal: 1, p: 0, c: 0, f: 0, qty: 1 },
    { id: "legacy-123", name: "Old local item", meal: "Goûter", kcal: 90, p: 2, c: 10, f: 1, qty: 1 },
    { id: "deleted-123", name: "Deleted canonical", meal: "Dîner", kcal: 60, p: 1, c: 9, f: 1, qty: 1, __foodLogCanonical: true },
  ] as Array<{ id: string; name: string; meal: string; kcal: number; p: number; c: number; f: number; qty: number; __foodLogCanonical?: boolean }>;

  const merged = mergeCanonicalNutritionItems(local, [remote]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, canonical.id);
  assert.equal(merged[0].name, "Riz");
  assert.equal(merged[1].id, "legacy-123");
});

test("removes stale canonical cache entries after another client deletes the SQL row", () => {
  const local = [
    { id: "canonical-123", name: "Was deleted", meal: "Dîner", kcal: 50, p: 2, c: 5, f: 1, qty: 1, __foodLogCanonical: true },
    { id: "legacy-123", name: "Legacy item", meal: "Goûter", kcal: 30, p: 1, c: 4, f: 0, qty: 1 },
  ] as Array<{ id: string; name: string; meal: string; kcal: number; p: number; c: number; f: number; qty: number; __foodLogCanonical?: boolean }>;

  const merged = mergeCanonicalNutritionItems(local, []);
  assert.deepEqual(merged.map((item) => item.id), ["legacy-123"]);
});

test("honours pending deletion IDs while the SQL delete is in flight", () => {
  const merged = mergeCanonicalNutritionItems(
    [],
    [canonical],
    new Set([canonical.id]),
  );
  assert.deepEqual(merged, []);
});

test("accepts only valid, unexpired food-log tombstones", () => {
  const now = Date.parse("2026-11-05T10:00:00.000Z");
  const tombstones = readActiveNutritionTombstones(JSON.stringify({
    "00000000-0000-4000-8000-000000000001": "2026-11-05T09:00:00.000Z",
    "00000000-0000-4000-8000-000000000002": "2026-08-01T09:00:00.000Z",
    "not-a-uuid": "2026-11-05T09:00:00.000Z",
    "00000000-0000-4000-8000-000000000003": "invalid",
  }), now);

  assert.deepEqual(
    [...tombstones],
    ["00000000-0000-4000-8000-000000000001"],
  );
});

test("queues valid bounded tombstones and replaces the same ID deterministically", () => {
  const now = Date.parse("2026-11-05T10:00:00.000Z");
  const id = "00000000-0000-4000-8000-000000000001";
  const first = queueNutritionTombstone(null, id, now);
  const second = queueNutritionTombstone(JSON.stringify(first), id, now + 1000);

  assert.deepEqual(Object.keys(second), [id]);
  assert.equal(second[id], "2026-11-05T10:00:01.000Z");
  assert.throws(() => queueNutritionTombstone(null, "not-a-uuid", now), RangeError);
});

test("nutrition cache keys are unique per account and encode special characters", () => {
  const alice = nutritionAccountCacheKeys("user/alice");
  const bob = nutritionAccountCacheKeys("user:bob");

  assert.notEqual(alice.items, bob.items);
  assert.notEqual(alice.totals, bob.totals);
  assert.notEqual(alice.deletedIds, bob.deletedIds);
  assert.match(alice.deletedIds, /user%2Falice/);
  assert.match(bob.deletedIds, /user%3Abob/);
  assert.match(alice.items, /user%2Falice/);
  assert.match(bob.totals, /user%3Abob/);
  assert.notEqual(NUTRITION_CACHE_OWNER_KEY, alice.items);
  assert.notEqual(NUTRITION_UNASSIGNED_BACKUP_KEY, alice.items);
  assert.throws(() => nutritionAccountCacheKeys("  "));
});

test("unowned legacy Nutrition cache is never auto-assigned to a logged-in account", () => {
  assert.equal(mayReadGlobalNutritionCache(null, null), true);
  assert.equal(mayReadGlobalNutritionCache(null, "user-a"), false);
  assert.equal(mayReadGlobalNutritionCache("user-a", "user-a"), true);
  assert.equal(mayReadGlobalNutritionCache("user-a", "user-b"), false);
  assert.equal(mayReadGlobalNutritionCache("user-a", null), false);
});


test("rejects UUIDs without a valid version in nutrition tombstones", () => {
  assert.throws(
    () => queueNutritionTombstone(null, "00000000-0000-0000-8000-000000000001"),
    RangeError,
  );
});


test("fetches every food_log page beyond the PostgREST 1,000-row cap", async () => {
  const source = Array.from({ length: 1207 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    value: index,
  }));
  const cursors: Array<string | null> = [];
  const rows = await fetchAllFoodLogKeysetPages(async (afterId, limit) => {
    cursors.push(afterId);
    const start = afterId === null ? 0 : source.findIndex((row) => row.id === afterId) + 1;
    return { data: source.slice(start, start + limit), error: null };
  }, { pageSize: 500 });

  assert.deepEqual(rows, source);
  assert.deepEqual(cursors, [null, source[499].id, source[999].id]);
});

test("does not return or apply an incomplete food_log snapshot", async () => {
  let calls = 0;
  const rows = await fetchAllFoodLogKeysetPages(async (_afterId, limit) => {
    calls++;
    if (calls === 1) {
      return {
        data: Array.from({ length: limit }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        })),
        error: null,
      };
    }
    return { data: null, error: new Error("page unavailable") };
  }, { pageSize: 2 });

  assert.equal(rows, null);
  assert.equal(calls, 2);
});

test("rejects repeated or non-advancing food_log UUID cursors", async () => {
  let calls = 0;
  const rows = await fetchAllFoodLogKeysetPages(async () => {
    calls++;
    return calls === 1
      ? { data: [{ id: "b" }, { id: "c" }], error: null }
      : { data: [{ id: "c" }, { id: "d" }], error: null };
  }, { pageSize: 2 });

  assert.equal(rows, null);
  assert.equal(calls, 2);
});

test("stops food_log pagination when account scope is cancelled", async () => {
  let cancelled = false;
  let calls = 0;
  const rows = await fetchAllFoodLogKeysetPages(async () => {
    calls++;
    cancelled = true;
    return { data: [{ id: "a" }], error: null };
  }, { pageSize: 2, isCancelled: () => cancelled });

  assert.equal(rows, null);
  assert.equal(calls, 1);
});

test("rejects invalid food_log page sizes", async () => {
  await assert.rejects(
    () => fetchAllFoodLogKeysetPages(async () => ({ data: [], error: null }), { pageSize: 0 }),
    RangeError,
  );
});


test("merges successive guest snapshots without dropping earlier foods", () => {
  const earlier = {
    "2026-11-05": [
      { id: "guest-a", name: "Toast", meal: "Matin", kcal: 100, p: 3, c: 18, f: 1, qty: 1 },
      { id: "guest-b", name: "Pomme", meal: "Goûter", kcal: 80, p: 0, c: 20, f: 0, qty: 1 },
    ],
  };
  const later = {
    "2026-11-05": [
      { id: "guest-b", name: "Pomme corrigée", meal: "Goûter", kcal: 95, p: 0, c: 24, f: 0, qty: 1 },
      { id: "guest-c", name: "Yaourt", meal: "Soir", kcal: 120, p: 8, c: 12, f: 4, qty: 1 },
    ],
    "2026-11-06": [
      { id: "guest-d", name: "Banane", meal: "Matin", kcal: 90, p: 1, c: 23, f: 0, qty: 1 },
    ],
  };

  const merged = mergeUnassignedNutritionSnapshots(JSON.stringify(earlier), JSON.stringify(later));
  assert.ok(merged);
  assert.deepEqual(merged["2026-11-05"].map((item) => item.id), ["guest-a", "guest-b", "guest-c"]);
  assert.equal(merged["2026-11-05"][1].name, "Pomme corrigée");
  assert.deepEqual(merged["2026-11-06"].map((item) => item.id), ["guest-d"]);
});

test("does not replace a valid guest backup with malformed cache data", () => {
  assert.equal(
    mergeUnassignedNutritionSnapshots('{"2026-11-05":[]}', "{broken"),
    null,
  );
});
