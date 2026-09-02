import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await readFile("src/hooks/use-cloud-sync-engine.tsx", "utf8");
const storage = await readFile("src/lib/storage.ts", "utf8");
const domainStore = await readFile("src/lib/domain-store.ts", "utf8");
const profileSync = await readFile("src/hooks/use-profile-realtime.ts", "utf8");
const profileRoute = await readFile("src/routes/profile.tsx", "utf8");
const goals = await readFile("src/hooks/use-user-goals.tsx", "utf8");
const profileMigration = await readFile("supabase/migrations/20260821090000_profile_sync_hardening.sql", "utf8");
const migrations = await readFile("supabase/migrations/20260902092340_fix_event_driven_sync_timestamp_reconciliation.sql", "utf8");

assert.equal(/setInterval\s*\(|setTimeout\s*\(/.test(engine), false, "sync engine must not poll with timers");
assert.equal(engine.includes("location.reload"), false, "sync engine must not reload the app");
assert.match(engine, /onLocalWrite\(/, "local writes must be observed through an explicit mutation event");
assert.match(engine, /postgres_changes/, "remote changes must use Supabase Realtime");
assert.match(engine, /row\.updated_by === DEVICE_ID/, "self-originated realtime events must be ignored");
assert.match(engine, /activeWrites\.current\.has\(row\.key\)/, "remote events must not overwrite an in-flight local mutation");
assert.match(engine, /localChangedWhileInFlight/, "rapid local mutations must be protected from late remote results");
assert.match(engine, /queueKey\(key\)/, "failed/offline writes must remain queued");
assert.match(engine, /unqueueKey\(key\)/, "successful writes must leave the queue only after confirmation");

assert.match(storage, /REMOTE_WRITE_EVENT/, "storage must expose a remote-write channel");
assert.match(storage, /LOCAL_WRITE_EVENT/, "storage must expose a local-write channel");
assert.match(storage, /suppressPersistRef/, "remote React state hydration must suppress the persistence effect");
assert.match(storage, /remoteWrite|REMOTE_WRITE/, "remote hydration must have an explicit remote-write path");
assert.match(storage, /previous === serialized/, "unchanged local values must not emit writes");
assert.doesNotMatch(domainStore, /enqueueDomainWrite|peekDomainOutbox|markDomainOutboxSent/, "there must not be a second domain outbox architecture");

assert.match(profileSync, /postgres_changes/, "profiles must use Realtime");
assert.match(profileSync, /updated_by === deviceId/, "profile self-originated events must be ignored");
assert.match(profileRoute, /upsert_profile_if_newer/, "profile writes must use the version-safe RPC");
assert.match(profileRoute, /PROFILE_REMOTE_EVENT/, "profile UI must consume centralized remote events");
assert.match(goals, /PROFILE_REMOTE_EVENT/, "derived profile consumers must receive remote changes");
assert.match(profileMigration, /upsert_profile_if_newer/, "profile conflict RPC must exist");
assert.match(profileMigration, /auth\.uid\(\) IS NULL OR auth\.uid\(\) <> p_user_id/, "profile RPC must enforce ownership");

assert.match(migrations, /IF NEW\.updated_at IS NOT DISTINCT FROM OLD\.updated_at/, "timestamp trigger must preserve explicit sync timestamps");
assert.match(migrations, /upsert_user_state_if_newer/, "sync RPC repair migration must exist");

console.log("Cloud sync regression checks passed.");
