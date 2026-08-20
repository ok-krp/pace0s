import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile("src/hooks/use-cloud-sync-engine.tsx", "utf8");
const storage = await readFile("src/lib/storage.ts", "utf8");
const migrations = await readFile("supabase/migrations/20260820235000_sync_timestamp_trigger_fix.sql", "utf8");

// Local changes are event-driven; there must be no timer/polling loop in the sync engine.
assert.equal(/setInterval\s*\(|setTimeout\s*\(/.test(engine), false, "sync engine must not poll with timers");
assert.equal(engine.includes("location.reload"), false, "sync engine must not reload the app");
assert.match(engine, /onLocalWrite\(/, "local writes must be observed through an explicit mutation event");
assert.match(engine, /postgres_changes/, "remote changes must use Supabase Realtime");
assert.match(engine, /updated_by === DEVICE_ID/, "self-originated realtime events must be ignored");
assert.match(engine, /activeWrites\.current\.has\(row\.key\)/, "remote events must not overwrite an in-flight local mutation");
assert.match(engine, /localChangedWhileInFlight/, "rapid local mutations must be protected from late remote results");
assert.match(engine, /queueKey\(key\)/, "failed/offline writes must remain queued");
assert.match(engine, /unqueueKey\(key\)/, "successful writes must leave the queue only after confirmation");

// Remote application must be explicitly separated from local mutation events.
assert.match(storage, /REMOTE_WRITE_EVENT/, "storage must expose a remote-write channel");
assert.match(storage, /LOCAL_WRITE_EVENT/, "storage must expose a local-write channel");
assert.match(storage, /do not emit a sync event for it/, "initial hydration must not be treated as a user mutation");

// The database trigger must preserve timestamps explicitly supplied by the conflict-safe RPC.
assert.match(migrations, /IF NEW\.updated_at IS NOT DISTINCT FROM OLD\.updated_at/, "timestamp trigger must preserve explicit sync timestamps");
assert.match(migrations, /upsert_user_state_if_newer/, "sync RPC repair migration must exist");

console.log("Cloud sync regression checks passed.");
