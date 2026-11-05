import test from "node:test";
import assert from "node:assert/strict";
import { accountSyncStorageKeys, isLatestKeyWrite, parseSyncMetadata, parseSyncQueue, syncPullCursor, syncPullPlan } from "./cloud-sync-scope.ts";

test("sync queue and metadata storage are isolated by authenticated user", () => {
  const alice = accountSyncStorageKeys("user/alice");
  const bob = accountSyncStorageKeys("user:bob");

  assert.notEqual(alice.queue, bob.queue);
  assert.notEqual(alice.metadata, bob.metadata);
  assert.match(alice.queue, /user%2Falice$/);
  assert.match(bob.metadata, /user%3Abob$/);
  assert.throws(() => accountSyncStorageKeys("  "));
});

test("legacy unscoped queue is not implicitly adopted by an authenticated account", () => {
  const legacyQueue = '["pace.nutrition.items"]';
  const storage = new Map([["pace.__sync_queue", legacyQueue]]);
  const aliceQueueKey = accountSyncStorageKeys("user/alice").queue;

  // The account-scoped reader looks up only Alice's key; it must not replay
  // the old global queue because that queue has no trustworthy owner marker.
  assert.deepEqual(parseSyncQueue(storage.get(aliceQueueKey) ?? null), []);
});

test("queue parser rejects malformed, non-string and non-Pace keys and de-duplicates", () => {
  assert.deepEqual(parseSyncQueue("{"), []);
  assert.deepEqual(parseSyncQueue('{"key":"pace.water"}'), []);
  assert.deepEqual(parseSyncQueue('["pace.water","pace.water","lt.water",4,null]'), ["pace.water"]);
});

test("metadata parser accepts only valid timestamps for Pace keys", () => {
  assert.deepEqual(parseSyncMetadata("{"), {});
  assert.deepEqual(parseSyncMetadata(JSON.stringify({
    "pace.water": "2026-10-31T12:00:00.000Z",
    "pace.nutrition.items": "invalid",
    "pace.profile.age": "2026-10-31T12:00:00",
    "lt.water": "2026-10-31T12:00:00.000Z",
    "other": "2026-10-31T12:00:00.000Z",
  })), { "pace.water": "2026-10-31T12:00:00.000Z" });
});

test("incremental pull cursor uses an overlap from the newest account watermark", () => {
  const now = Date.parse("2026-11-04T20:00:00.000Z");
  const cursor = syncPullCursor({
    "pace.water": "2026-11-04T19:58:00.000Z",
    "pace.nutrition.items": "2026-11-04T19:59:00.000Z",
  }, now, 5 * 60 * 1000);

  assert.equal(cursor, "2026-11-04T19:54:00.000Z");
});

test("missing pull watermarks require full reconciliation and future values are capped", () => {
  const now = Date.parse("2026-11-04T20:00:00.000Z");
  assert.equal(syncPullCursor({}, now), null);
  assert.equal(
    syncPullCursor({ "pace.water": "2026-11-04T20:01:00.000Z" }, now),
    "2026-11-04T19:55:00.000Z",
  );
});

test("incremental pull cursor rejects invalid overlap configuration", () => {
  assert.throws(() => syncPullCursor({}, Date.now(), -1), RangeError);
});

test("pull plan uses the last full scan when an empty account has no row metadata", () => {
  const now = Date.parse("2026-11-04T20:00:00.000Z");
  const plan = syncPullPlan(
    {},
    Date.parse("2026-11-04T19:59:00.000Z"),
    now,
    5 * 60 * 1000,
    24 * 60 * 60 * 1000,
  );

  assert.deepEqual(plan, {
    fullReconciliation: false,
    cursor: "2026-11-04T19:54:00.000Z",
  });
});

test("pull plan schedules a full scan after 24 hours and on clock rollback", () => {
  const now = Date.parse("2026-11-04T20:00:00.000Z");
  const dayOld = syncPullPlan(
    { "pace.water": "2026-11-03T19:00:00.000Z" },
    now - 24 * 60 * 60 * 1000,
    now,
  );
  assert.equal(dayOld.fullReconciliation, true);

  const clockRollback = syncPullPlan(
    { "pace.water": "2026-11-04T19:59:00.000Z" },
    now + 60 * 60 * 1000,
    now,
  );
  assert.equal(clockRollback.fullReconciliation, true);
  assert.equal(clockRollback.cursor, "2026-11-04T19:55:00.000Z");
});

test("pull plan rejects invalid reconciliation intervals", () => {
  assert.throws(
    () => syncPullPlan({}, 0, Date.now(), 300_000, 0),
    RangeError,
  );
});

test("only the latest same-key push may acknowledge its local outbox entry", () => {
  assert.equal(isLatestKeyWrite(1, 1), true);
  assert.equal(isLatestKeyWrite(1, 2), false);
  assert.equal(isLatestKeyWrite(2, 2), true);
  assert.equal(isLatestKeyWrite(0, 0), false);
  assert.equal(isLatestKeyWrite(Number.NaN, 1), false);
  assert.equal(isLatestKeyWrite(1, Number.POSITIVE_INFINITY), false);
});
