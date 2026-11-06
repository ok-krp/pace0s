import test from "node:test";
import assert from "node:assert/strict";
import {
  mapFoodLogRow,
  mergeCanonicalNutritionItems,
  mergeCanonicalNutritionDelta,
  fetchAllFoodLogKeysetPages,
  fetchAllFoodLogTuplePages,
  mergeUnassignedNutritionSnapshots,
  mergeNutritionTombstoneMaps,
  mayReadGlobalNutritionCache,
  NUTRITION_CACHE_OWNER_KEY,
  NUTRITION_UNASSIGNED_BACKUP_KEY,
  nutritionAccountCacheKeys,
  queueNutritionTombstone,
  readActiveNutritionTombstones,
  foodLogDeltaSince,
  compareFoodLogTupleCursor,
  nextNutritionFoodLogCursor,
  parseNutritionFoodLogCursor,
  shouldRunFullFoodLogReconciliation,
} from "./nutrition-sync.ts";

const otherId = "00000000-0000-4000-8000-000000000002";

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

test("preserves secondary nutrients stored in canonical food_log metadata", () => {
  const mapped = mapFoodLogRow({
    ...canonical,
    meta: {
      sat_fat_g: 2.5,
      salt_g: 0.8,
      iron_mg: 3.2,
      calcium_mg: 120,
      vitamin_c_mg: 14,
    },
  });

  assert.equal(mapped.sat, 2.5);
  assert.equal(mapped.salt, 0.8);
  assert.equal(mapped.iron, 3.2);
  assert.equal(mapped.calcium, 120);
  assert.equal(mapped.vitC, 14);
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

test("omits optional nutrients explicitly marked as not provided", () => {
  const mapped = mapFoodLogRow({
    ...canonical,
    fiber_g: 0,
    sugar_g: 0,
    sodium_mg: 0,
    meta: { missing_nutrients: ["fiber_g", "sugar_g", "sodium_mg"] },
  });

  assert.equal("fiber" in mapped, false);
  assert.equal("sugar" in mapped, false);
  assert.equal("sodium" in mapped, false);
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


test("merges account-local and cloud tombstones without losing newer deletions", () => {
  const now = Date.parse("2026-11-06T12:00:00.000Z");
  const firstId = "00000000-0000-4000-8000-000000000001";
  const secondId = "00000000-0000-4000-8000-000000000002";
  const merged = mergeNutritionTombstoneMaps(
    JSON.stringify({
      [firstId]: new Date(now - 60_000).toISOString(),
      "not-a-uuid": new Date(now).toISOString(),
    }),
    JSON.stringify({
      [firstId]: new Date(now - 30_000).toISOString(),
      [secondId]: new Date(now - 10_000).toISOString(),
    }),
  );

  assert.deepEqual(Object.keys(merged).sort(), [firstId, secondId].sort());
  assert.equal(merged[firstId], new Date(now - 30_000).toISOString());
  assert.equal(merged[secondId], new Date(now - 10_000).toISOString());
});


test("account cache has an isolated per-day food-log cursor key", () => {
  const alice = nutritionAccountCacheKeys("user/alice");
  const bob = nutritionAccountCacheKeys("user:bob");
  assert.notEqual(alice.foodLogCursor, bob.foodLogCursor);
  assert.match(alice.foodLogCursor, /user%2Falice/);
  assert.match(bob.foodLogCursor, /user%3Abob/);
});

test("requires a full food-log scan for a missing, stale or different-day cursor", () => {
  const now = Date.parse("2026-11-06T12:00:00.000Z");
  const cursor = {
    logDate: "2026-11-06",
    createdAt: "2026-11-06T11:59:00.000Z",
    id: canonical.id,
    lastFullAt: new Date(now - 60_000).toISOString(),
  };
  assert.equal(shouldRunFullFoodLogReconciliation(null, "2026-11-06", now), true);
  assert.equal(shouldRunFullFoodLogReconciliation(cursor, "2026-11-07", now), true);
  assert.equal(
    shouldRunFullFoodLogReconciliation({
      ...cursor,
      lastFullAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    }, "2026-11-06", now),
    true,
  );
  assert.equal(shouldRunFullFoodLogReconciliation(cursor, "2026-11-06", now), false);
});

test("rejects malformed or wrong-day persisted food-log cursors", () => {
  const cursor = {
    logDate: "2026-11-06",
    createdAt: "2026-11-06T11:59:00.123456Z",
    id: canonical.id,
    lastFullAt: "2026-11-06T11:00:00.000Z",
  };
  assert.deepEqual(
    parseNutritionFoodLogCursor(JSON.stringify(cursor), "2026-11-06"),
    cursor,
  );
  assert.equal(parseNutritionFoodLogCursor("{broken", "2026-11-06"), null);
  assert.equal(parseNutritionFoodLogCursor(JSON.stringify(cursor), "2026-11-07"), null);
  assert.equal(
    parseNutritionFoodLogCursor(JSON.stringify({ ...cursor, id: "not-a-uuid" }), "2026-11-06"),
    null,
  );
});

test("uses a bounded five-minute overlap for incremental food-log pulls", () => {
  const cursor = {
    logDate: "2026-11-06",
    createdAt: "2026-11-06T12:00:00.000Z",
    id: canonical.id,
    lastFullAt: "2026-11-06T11:00:00.000Z",
  };
  assert.equal(foodLogDeltaSince(cursor), "2026-11-06T11:55:00.000Z");
});

test("advances the food-log cursor only from a complete scan and keeps its full-scan time", () => {
  const now = Date.parse("2026-11-06T12:00:00.000Z");
  const previous = {
    logDate: "2026-11-06",
    createdAt: "2026-11-06T11:59:00.000Z",
    id: canonical.id,
    lastFullAt: "2026-11-06T10:00:00.000Z",
  };
  const next = nextNutritionFoodLogCursor({
    previous,
    rows: [{ id: otherId, created_at: "2026-11-06T12:00:00.123456Z" }],
    logDate: "2026-11-06",
    fullReconciliation: false,
    nowMs: now,
  });
  assert.equal(next.createdAt, "2026-11-06T12:00:00.000Z");
  assert.equal(next.id, null);
  assert.equal(next.lastFullAt, previous.lastFullAt);

  const emptyFull = nextNutritionFoodLogCursor({
    previous: null,
    rows: [],
    logDate: "2026-11-06",
    fullReconciliation: true,
    nowMs: now,
  });
  assert.equal(emptyFull.id, null);
  assert.equal(emptyFull.createdAt, "2026-11-06T12:00:00.000Z");
  assert.equal(emptyFull.lastFullAt, "2026-11-06T12:00:00.000Z");
});

test("advances an empty incremental delta so repeated polls do not rescan the same window", () => {
  const now = Date.parse("2026-11-06T12:01:00.000Z");
  const previous = {
    logDate: "2026-11-06",
    createdAt: "2026-11-06T12:00:00.000Z",
    id: null,
    lastFullAt: "2026-11-06T10:00:00.000Z",
  };
  const next = nextNutritionFoodLogCursor({
    previous,
    rows: [],
    logDate: "2026-11-06",
    fullReconciliation: false,
    nowMs: now,
  });
  assert.equal(next.createdAt, "2026-11-06T12:01:00.000Z");
  assert.equal(next.id, null);
  assert.equal(next.lastFullAt, previous.lastFullAt);
  assert.equal(foodLogDeltaSince(next), "2026-11-06T11:56:00.000Z");
});

test("compares adjacent food_log microseconds without floating-point precision loss", () => {
  assert.equal(
    compareFoodLogTupleCursor(
      { createdAt: "2026-11-06T12:00:00.123456Z", id: canonical.id },
      { createdAt: "2026-11-06T12:00:00.123457Z", id: canonical.id },
    ),
    -1,
  );
  assert.equal(
    compareFoodLogTupleCursor(
      { createdAt: "2026-11-06T12:00:00.123456Z", id: canonical.id },
      { createdAt: "2026-11-06T12:00:00.123456Z", id: otherId },
    ),
    -1,
  );
});

test("compares equivalent UTC and offset food-log timestamps by UUID", () => {
  assert.equal(
    compareFoodLogTupleCursor(
      { createdAt: "2026-11-06T12:00:00.123456Z", id: canonical.id },
      { createdAt: "2026-11-06T13:00:00.123456+01:00", id: otherId },
    ),
    -1,
  );
});

test("paginates food_log by created_at then UUID, including equal timestamp rows", async () => {
  const source = [
    { ...canonical, created_at: "2026-11-06T12:00:00.123456Z" },
    { ...canonical, id: otherId, created_at: "2026-11-06T12:00:00.123456Z" },
    { ...canonical, id: "00000000-0000-4000-8000-000000000003", created_at: "2026-11-06T12:00:00.123457Z" },
  ];
  const cursors: Array<{ createdAt: string; id: string } | null> = [];
  const rows = await fetchAllFoodLogTuplePages(async (after, limit) => {
    cursors.push(after);
    const start = after === null
      ? 0
      : source.findIndex((row) =>
          row.created_at === after.createdAt && row.id === after.id,
        ) + 1;
    return { data: source.slice(start, start + limit), error: null };
  }, { pageSize: 2 });

  assert.deepEqual(rows, source);
  assert.deepEqual(cursors, [
    null,
    { createdAt: source[1].created_at, id: source[1].id },
  ]);
});

test("does not return a partial tuple-paginated food_log snapshot", async () => {
  let calls = 0;
  const rows = await fetchAllFoodLogTuplePages(async (_after, limit) => {
    calls++;
    if (calls === 1) {
      return {
        data: Array.from({ length: limit }, (_, index) => ({
          ...canonical,
          id: index === 0 ? canonical.id : otherId,
          created_at: `2026-11-06T12:00:00.00000${index}Z`,
        })),
        error: null,
      };
    }
    return { data: null, error: new Error("page unavailable") };
  }, { pageSize: 2 });

  assert.equal(rows, null);
  assert.equal(calls, 2);
});

test("rejects a repeated or regressing created_at/UUID tuple cursor", async () => {
  let calls = 0;
  const rows = await fetchAllFoodLogTuplePages(async () => {
    calls++;
    return calls === 1
      ? { data: [
          { ...canonical, created_at: "2026-11-06T12:00:00.000Z" },
          { ...canonical, id: otherId, created_at: "2026-11-06T12:00:00.000Z" },
        ], error: null }
      : { data: [
          { ...canonical, id: otherId, created_at: "2026-11-06T12:00:00.000Z" },
          { ...canonical, created_at: "2026-11-06T11:59:59.999Z" },
        ], error: null };
  }, { pageSize: 2 });

  assert.equal(rows, null);
  assert.equal(calls, 2);
});

test("incremental Nutrition merge retains canonical rows not present in the delta", () => {
  const untouched = {
    ...canonical,
    id: "00000000-0000-4000-8000-000000000099",
    name: "Ancien repas",
    created_at: "2026-11-06T10:00:00.000Z",
  };
  const local = [
    mapFoodLogRow(untouched),
    { id: "legacy-row", name: "Ancienne ligne locale", meal: "Goûter", kcal: 90, p: 2, c: 10, f: 1, qty: 1 },
  ];
  const delta = [{ ...canonical, created_at: "2026-11-06T12:00:00.000Z" }];
  const merged = mergeCanonicalNutritionDelta(local, delta);

  assert.deepEqual(merged.map((item) => item.id), [untouched.id, "legacy-row", canonical.id]);
  assert.equal(merged[2].name, canonical.name);
});

test("incremental Nutrition merge replaces an ID once and respects remote tombstones", () => {
  const local = [
    { id: canonical.id, name: "Ancienne version", meal: "Déjeuner", kcal: 1, p: 0, c: 0, f: 0, qty: 1, __foodLogCanonical: true },
    { id: otherId, name: "À supprimer", meal: "Dîner", kcal: 50, p: 2, c: 5, f: 1, qty: 1, __foodLogCanonical: true },
  ] as Array<{ id: string; name: string; meal: string; kcal: number; p: number; c: number; f: number; qty: number; __foodLogCanonical?: boolean }>;
  const merged = mergeCanonicalNutritionDelta(
    local,
    [{ ...canonical, name: "Riz corrigé", created_at: "2026-11-06T12:00:00.000Z" }],
    new Set([otherId]),
  );
  assert.deepEqual(merged.map((item) => item.id), [canonical.id]);
  assert.equal(merged[0].name, "Riz corrigé");
});
