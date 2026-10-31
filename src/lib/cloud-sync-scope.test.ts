import test from "node:test";
import assert from "node:assert/strict";
import { accountSyncStorageKeys, parseSyncMetadata, parseSyncQueue } from "./cloud-sync-scope.ts";

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
