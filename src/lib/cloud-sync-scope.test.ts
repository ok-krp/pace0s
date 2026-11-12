import test from "node:test";
import assert from "node:assert/strict";
import { accountSyncStorageKeys, DEVICE_LOCAL_EXACT_KEYS, DEVICE_LOCAL_REMOTE_KEY_PATTERNS, isLatestKeyWrite, isSyncableLocalKey, nextSyncWriteTimestamp, parseSyncMetadata, parseSyncQueue, syncPullCursor, syncPullPlan } from "./cloud-sync-scope.ts";

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
  assert.deepEqual(parseSyncQueue('["pace.water","pace.water","pace.__sync_queue","pace.__sync_last_full_reconcile_at","lt.water",4,null]'), ["pace.water"]);
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

test("per-key write timestamps advance when multiple edits share one millisecond", () => {
  const now = Date.parse("2026-11-05T09:00:00.123Z");
  const first = nextSyncWriteTimestamp(now);
  const second = nextSyncWriteTimestamp(now, first);
  const third = nextSyncWriteTimestamp(now, second);

  assert.equal(first, "2026-11-05T09:00:00.123Z");
  assert.equal(second, "2026-11-05T09:00:00.124Z");
  assert.equal(third, "2026-11-05T09:00:00.125Z");
});

test("per-key write timestamps recover from invalid previous metadata", () => {
  const now = Date.parse("2026-11-05T09:00:00.123Z");
  assert.equal(
    nextSyncWriteTimestamp(now, "invalid"),
    "2026-11-05T09:00:00.123Z",
  );
  assert.throws(() => nextSyncWriteTimestamp(Number.NaN), RangeError);
  assert.throws(() => nextSyncWriteTimestamp(-1), RangeError);
});

test("reserved internal sync keys are never treated as user domain state", () => {
  assert.equal(isSyncableLocalKey("pace.nutrition.items"), true);
  assert.equal(isSyncableLocalKey("pace.settings.theme"), true);
  assert.equal(isSyncableLocalKey("pace.wallpaper"), false);
  assert.equal(isSyncableLocalKey("pace.sport.active"), false);
  assert.equal(isSyncableLocalKey("pace.ai.conversations"), false);
  assert.equal(isSyncableLocalKey("pace.ai.deleted_conversations"), false);
  for (const key of [
    "pace.privacy.pin.hash",
    "pace.privacy.bioCredentialId",
    "pace.privacy.lockOnEnter",
    "pace.ble.devices",
    "pace.ble.mapping",
    "pace.ble.seen",
    "pace.import.log",
    "pace.local-ai.enabled",
    "pace.ai.pending:conversation-1",
    "pace.ai.debug",
    "pace.billing.device_id",
    "pace.watch.last_metrics",
    "pace.finance.pin.hash",
  ]) {
    assert.equal(isSyncableLocalKey(key), false, key);
  }
  assert.equal(isSyncableLocalKey("pace.__sync_queue"), false);
  assert.equal(isSyncableLocalKey("pace.__sync_meta:user-a"), false);
  assert.equal(isSyncableLocalKey("pace.__sync_food_log_outbox:user-a"), false);
  assert.equal(isSyncableLocalKey("pace.__nutrition_cache:user-a:items"), false);
  assert.equal(isSyncableLocalKey("pace.__nutrition_cache:user-a:food_log_cursor"), false);
  assert.equal(isSyncableLocalKey("pace.__nutrition_cache:user-a:deleted_ids"), false);
  assert.equal(isSyncableLocalKey("lt.water"), false);
  assert.equal(isSyncableLocalKey("__outbox"), false);
});

test("automatic and manual PostgREST pulls share all exact device-local aliases", () => {
  for (const key of [
    "pace.sport.active",
    "lt.sport.active",
    "pace.ai.conversations",
    "lt.ai.conversations",
    "pace.ai.deleted_conversations",
    "lt.ai.deleted_conversations",
    "pace.wallpaper",
    "lt.wallpaper",
    "pace.finance.pin.hash",
    "lt.finance.pin.hash",
    "pace.ai.debug",
    "lt.ai.debug",
    "pace.billing.device_id",
    "lt.billing.device_id",
    "pace.watch.last_metrics",
    "lt.watch.last_metrics",
  ]) {
    assert.ok((DEVICE_LOCAL_EXACT_KEYS as readonly string[]).includes(key), key);
    assert.equal(isSyncableLocalKey(key), false, key);
  }
  const prefixes = DEVICE_LOCAL_REMOTE_KEY_PATTERNS.map((pattern) => new RegExp(pattern));
  for (const key of ["pace.privacy.pin.hash", "lt.ble.devices", "pace.import.log", "lt.local-ai.enabled"]) {
    assert.ok(prefixes.some((pattern) => pattern.test(key)), key);
  }
  for (const key of ["pace.ai.pending:conversation-1", "lt.ai.pending:conversation-1"]) {
    assert.ok(prefixes.some((pattern) => pattern.test(key)), key);
  }
});
