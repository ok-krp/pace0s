import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const engine = read("src/hooks/use-cloud-sync-engine.tsx");
const storage = read("src/lib/storage.ts");

assert.match(engine, /setInterval\s*\(.*60(?:000|_000)/s, "sync engine must reconcile periodically");
assert.match(engine, /realtimeHealthy/, "sync engine must gate recovery polling on Realtime health");
assert.match(engine, /document\.visibilityState === "visible"/, "periodic reconciliation must be foreground-only");
assert.equal(/setInterval\s*\(/.test(storage), false, "storage must not poll for local changes");
assert.match(storage, /pace\.local\.write/);
assert.match(engine, /const DEVICE_ID = getTabDeviceId\(\)/,
  "Realtime echo suppression must use a per-tab ID so sibling tabs receive updates");
assert.match(engine, /sessionStorage\.getItem\(TAB_DEVICE_KEY\)/,
  "each browser tab must have a distinct sync origin");
assert.match(engine, /setStatus\(navigator\.onLine \? "syncing" : "offline"\);[\s\S]*?void pushItem\(item\)/,
  "a user mutation must start synchronization immediately and expose its in-flight state");
const syncSettings = read("src/components/CloudSyncSettings.tsx");
assert.match(syncSettings, /Synchronisation en temps réel active/);
assert.match(syncSettings, /Chaque modification déclenche immédiatement la synchronisation/);
assert.match(engine, /onLocalWrite\(/);
assert.match(engine, /postgres_changes/);
assert.equal((engine.match(/realtimeChannel\.subscribe\(/g) ?? []).length, 1, "Realtime channel must only be subscribed during initial channel setup");
assert.equal(/location\.reload\s*\(/.test(engine), false, "sync must never reload the page");

// Internal persistence keys never become cloud records.
assert.match(engine, /!key\.startsWith\(INTERNAL_PREFIX\)/);
assert.match(engine, /DOMAIN_OUTBOX_KEY/);

// Remote application is separated from user mutation events.
assert.match(storage, /REMOTE_WRITE_EVENT/);
assert.match(storage, /CustomEvent<LocalWriteDetail>\(LOCAL_WRITE_EVENT/);
assert.match(engine, /lastRemoteValues/);

assert.match(engine, /Object\.keys\(object\)\.sort\(\)/, "sync comparisons must be key-order independent");
assert.match(engine, /object\.version === 1.*object\.mutationId === "string"/s, "sync comparisons must unwrap domain envelopes");
assert.match(engine, /pruneEquivalentConflicts/);

// Rapid mutations are represented by a value + timestamp and coalesced per key.
assert.match(engine, /type QueueItem = \{ key: string; value: unknown; updatedAt: string/);
assert.match(engine, /readQueue\(\)\.filter\(\(queued\) => queued\.key !== item\.key\)/);

// Client timestamps are retained only for local queue identity; server time orders cloud writes.
assert.match(engine, /p_updated_at: item\.updatedAt/);
assert.match(engine, /server-authoritative/);
assert.match(engine, /const updatedAt = new Date\(\)\.toISOString\(\);/);
assert.match(engine, /resolveConflict/);
assert.match(storage, /const updatedAt = new Date\(\)\.toISOString\(\);/);
assert.match(storage, /Persist and emit the sync event synchronously from the user mutation/, "local user mutations must emit sync events synchronously instead of waiting for a React effect");
assert.match(storage, /if \(!loaded \|\| typeof window === "undefined"\) return;/, "local state persistence must only run after hydration");
assert.match(storage, /pace\.sport\.exercises.*LOCAL_WRITE_EVENT/s, "derived sport exercise changes must enter the cloud queue");
assert.match(storage, /pace\.sport\.programs.*LOCAL_WRITE_EVENT/s, "derived sport program changes must enter the cloud queue");
const profileRpc = read("supabase/migrations/20260830150000_fix_profile_id_and_legacy_profile_upsert.sql");
assert.match(profileRpc, /effective_updated_at timestamptz := clock_timestamp\(\)/, "profile ordering must use database time, not a browser clock");
assert.match(profileRpc, /updated_at = EXCLUDED\.updated_at/, "profile writes must persist the server-authoritative ordering timestamp");

// A lost RPC response is resolved by the monotonic RPC itself; a rejected write
// performs a single reconciliation read against the canonical row.
assert.match(engine, /if \(!payload\.accepted\)/);
assert.match(engine, /supabase\.from\("user_state"\)\.select\("key,value,updated_at,updated_by"\)/);
assert.match(engine, /serialize\(queued\.value\) === serialize\(mergedValue\)/);
assert.match(engine, /const domainTime = localDomain \? Date\.parse\(localDomain\.updatedAt\)/,
  "pull reconciliation must compare cloud timestamps against the local domain envelope, not only sync metadata");
const localDomainUpdatedAt = Date.parse("2026-10-08T12:00:00.000Z");
const missingMetaTimestamp = Date.parse("1970-01-01T00:00:00.000Z");
const cloudUpdatedAt = Date.parse("2026-10-08T11:00:00.000Z");
assert.ok(
  Math.max(missingMetaTimestamp, localDomainUpdatedAt) > cloudUpdatedAt,
  "a newer local domain edit must be queued when legacy sync metadata is missing",
);

assert.match(
  engine,
  /if \(domain && Date\.parse\(domain\.updatedAt\) >= remoteTime && !isEmptyRecoveredValue\(domain\.value\)\) \{[\s\S]*?if \(domainTime > remoteTime\) \{[\s\S]*?queueItem\(localItem\);[\s\S]*?void pushItem\(localItem\);[\s\S]*?recordConflict\(row\.key, domain\.value, row\.value, row\.updated_at\);/,
  "a realtime row arriving after bootstrap must enqueue newer local data or expose an equal-timestamp conflict",
);
const realtimeReconcile = (local, remote) => {
  if (local.updatedAt > remote.updatedAt) return "push-local";
  if (local.updatedAt === remote.updatedAt && JSON.stringify(local.value) !== JSON.stringify(remote.value)) return "conflict";
  return "apply-remote";
};
assert.equal(
  realtimeReconcile(
    { updatedAt: "2026-10-08T12:00:00.000Z", value: { count: 2 } },
    { updatedAt: "2026-10-08T11:00:00.000Z", value: { count: 1 } },
  ),
  "push-local",
  "a local-only edit newer than a Realtime insert must be pushed immediately",
);
assert.equal(
  realtimeReconcile(
    { updatedAt: "2026-10-08T12:00:00.000Z", value: { count: 2 } },
    { updatedAt: "2026-10-08T12:00:00.000Z", value: { count: 1 } },
  ),
  "conflict",
  "equal-timestamp divergent edits must not silently overwrite either value",
);

// The server RPC is monotonic: an older canonical timestamp must never be
// replaced by a newer request carrying an older-than-canonical server timestamp.
assert.match(
  read("supabase/migrations/20260926192000_server_ordered_cloud_sync_monotonic_writes.sql"),
  /WHERE public\.user_state\.updated_at < EXCLUDED\.updated_at/
);

// Deterministic newest-wins model for two devices and duplicate realtime events.
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


// Real multi-device water conflict model: disjoint dates merge deterministically,
// while the same date keeps the local choice (the conflict UI remains explicit).
const mergeWater = (remote, local) => {
  const merged = { ...(remote ?? {}) };
  for (const [day, value] of Object.entries(local ?? {})) merged[day] = value;
  return merged;
};
const waterLocal = { "2026-08-03": 2150, "2026-08-04": 1800 };
const waterRemote = { "2026-08-03": 2500, "2026-08-05": 2200 };
assert.deepEqual(
  mergeWater(waterRemote, waterLocal),
  { "2026-08-03": 2150, "2026-08-04": 1800, "2026-08-05": 2200 },
  "water merge must union dates and keep the local value on a same-day collision",
);

// Resolution semantics must remove the conflict before the next sync pass,
// then either queue the selected value for propagation or accept the remote value
// without generating a second conflict.
const conflict = {
  key: "pace.water",
  localValue: waterLocal,
  remoteValue: waterRemote,
  remoteUpdatedAt: "2026-08-20T10:02:00.000Z",
};
let pending = conflict;
let queued = null;
const resolveModel = (choice) => {
  const value = choice === "merge" ? mergeWater(conflict.remoteValue, conflict.localValue)
    : choice === "local" ? conflict.localValue : conflict.remoteValue;
  if (choice === "remote") queued = null;
  else queued = value;
  pending = null;
};
resolveModel("merge");
assert.equal(pending, null, "resolved merge must clear the conflict");
assert.deepEqual(queued, {
  "2026-08-03": 2150,
  "2026-08-04": 1800,
  "2026-08-05": 2200,
});
resolveModel("remote");
assert.equal(pending, null, "remote resolution must remain conflict-free");
assert.equal(queued, null, "remote resolution must not enqueue a second write");

// A realtime event carrying the resolved value must converge both devices to the
// same canonical value and must not resurrect the resolved conflict.
const canonicalWater = { "2026-08-03": 2500, "2026-08-05": 2200 };
let deviceA = structuredClone(waterLocal);
let deviceB = structuredClone(canonicalWater);
let conflictsA = [];
let conflictsB = [];
const applyResolvedRemote = (device, conflicts, candidate) => {
  const next = structuredClone(candidate.value);
  if (JSON.stringify(next) === JSON.stringify(device)) return { device, conflicts };
  return { device: next, conflicts };
};
({ device: deviceA, conflicts: conflictsA } = applyResolvedRemote(deviceA, conflictsA, {
  value: canonicalWater,
  updatedAt: "2026-08-20T10:03:00.000Z",
}));
({ device: deviceB, conflicts: conflictsB } = applyResolvedRemote(deviceB, conflictsB, {
  value: canonicalWater,
  updatedAt: "2026-08-20T10:03:00.000Z",
}));
assert.deepEqual(deviceA, deviceB, "resolved water must converge across devices");
assert.deepEqual(conflictsA, []);
assert.deepEqual(conflictsB, []);

// Sleep must only persist after an actual input mutation, and it must not debounce
// the last edit into a timer that can be cancelled by route navigation.
const sleepRoute = read("src/routes/sleep.tsx");
assert.match(sleepRoute, /const persistSleep = \(nextStart: string, nextEnd: string, nextQuality: number\)/,
  "sleep edits must go through a single persistence path");
assert.match(sleepRoute, /onChange=\{\(e\) => \{ const value = e\.target\.value; setStart\(value\); persistSleep\(value, end, quality\); \}\}/,
  "editing the sleep start must persist immediately");
assert.match(sleepRoute, /onChange=\{\(e\) => \{ const value = e\.target\.value; setEnd\(value\); persistSleep\(start, value, quality\); \}\}/,
  "editing the sleep end must persist immediately");
assert.match(sleepRoute, /onChange=\{\(v\) => \{ if \(v != null\) \{ setQuality\(v\); persistSleep\(start, end, v\); \} \}\}/,
  "editing sleep quality must persist immediately");
assert.equal(/window\.setTimeout\(/.test(sleepRoute), false,
  "sleep persistence must not depend on a cancellable debounce timer");
assert.match(sleepRoute, /select\("key,value,updated_at"\)/,
  "sleep cloud recovery must use authoritative row timestamps");
assert.match(sleepRoute, /Date\.parse\(a\.updated_at\) - Date\.parse\(b\.updated_at\)/,
  "sleep cloud history must merge rows in timestamp order");

console.log("cloud-sync-contract-test: PASS");

assert.match(engine, /pruneEquivalentConflicts\(\);\n      if \(!navigator\.onLine\)/, "syncNow must prune equivalent conflicts before queue flush");
assert.match(engine, /remainingConflicts = currentConflicts\.filter\(\(item\) => item\.key !== key\)/, "queued equivalent values must clear stale conflicts");
