import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const engine = read("src/hooks/use-cloud-sync-engine.tsx");
const storage = read("src/lib/storage.ts");
const domainStore = read("src/lib/domain-store.ts");
const sql = read("supabase/migrations/20260821000000_event_driven_sync_timestamp_fix.sql");

assert.equal(/setInterval\s*\(/.test(engine), false, "sync engine must not poll with setInterval");
assert.equal(/setInterval\s*\(/.test(storage), false, "storage must not poll for local changes");
assert.match(storage, /pace\.local\.write/);
assert.match(engine, /onLocalWrite\(/);
assert.match(engine, /postgres_changes/);
assert.equal(/location\.reload\s*\(/.test(engine), false, "sync must never reload the page");

// Internal persistence keys never become cloud records; canonical domain state does.
assert.match(engine, /!key\.startsWith\(INTERNAL_PREFIX\)/);
assert.match(engine, /DOMAIN_OUTBOX_KEY/);
assert.match(engine, /key\.startsWith\(DOMAIN_PREFIX\)/);

// Remote application is separated from user mutation events.
assert.match(storage, /REMOTE_WRITE_EVENT/);
assert.match(storage, /window\.dispatchEvent\(new CustomEvent<LocalWriteDetail>\(LOCAL_WRITE_EVENT/);
assert.match(engine, /lastRemoteValues/);
assert.match(domainStore, /updatedAt: record\.updatedAt, mutationId: record\.mutationId/);

// Rapid mutations are represented by a value + timestamp and coalesced per key.
assert.match(engine, /type QueueItem = \{ key: string; value: unknown; updatedAt: string/);
assert.match(engine, /readQueue\(\)\.filter\(\(queued\) => queued\.key !== item\.key\)/);
assert.match(engine, /Rapid edits are coalesced/);

// Cloud writes use the mutation timestamp captured at the user action, not send time.
assert.match(engine, /p_updated_at: latest\.updatedAt/);
assert.doesNotMatch(engine, /const updatedAt = new Date\(\)\.toISOString\(\);/);

// SQL preserves explicit sync timestamps and enforces newest-wins in PostgreSQL.
assert.match(sql, /IF NEW\.updated_at IS NOT DISTINCT FROM OLD\.updated_at/);
assert.match(sql, /EXCLUDED\.updated_at > public\.user_state\.updated_at/);
assert.match(sql, /auth\.uid\(\) IS NULL OR auth\.uid\(\) <> p_user_id/);

// Deterministic two-device model for conflict and duplicate events.
const state = { value: "initial", updatedAt: "2026-08-20T10:00:00.000Z", updatedBy: "A" };
const apply = (candidate) => {
  if (Date.parse(candidate.updatedAt) > Date.parse(state.updatedAt)) Object.assign(state, candidate);
  return state.updatedBy === candidate.updatedBy && state.updatedAt === candidate.updatedAt;
};
assert.equal(apply({ value: "B", updatedAt: "2026-08-20T10:01:00.000Z", updatedBy: "B" }), true);
assert.equal(state.value, "B");
apply({ value: "A-old", updatedAt: "2026-08-20T10:00:30.000Z", updatedBy: "A" });
assert.equal(state.value, "B", "older remote mutation must not overwrite newer state");
apply({ value: "B", updatedAt: "2026-08-20T10:01:00.000Z", updatedBy: "B" });
assert.equal(state.value, "B", "duplicate realtime event must be idempotent");

console.log("cloud-sync-contract-test: PASS");
