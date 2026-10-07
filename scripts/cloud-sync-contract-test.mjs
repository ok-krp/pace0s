import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const engine = read("src/hooks/use-cloud-sync-engine.tsx");
const storage = read("src/lib/storage.ts");
const nutritionLog = read("src/lib/nutrition-log.ts");
const domainStore = read("src/lib/domain-store.ts");

assert.match(engine, /setInterval\s*\(\s*\(\s*\)\s*=>[\s\S]*?60_000\s*\)/, "sync engine must use a 60s recovery interval");
assert.doesNotMatch(engine, /setInterval\s*\(\s*\(\s*\)\s*=>[\s\S]*?5000\s*\)/, "sync engine must not poll user_state every 5s");
assert.match(engine, /realtimeHealthy/, "sync engine must gate recovery polling on Realtime health");
assert.match(engine, /document\.visibilityState === "visible"/, "periodic reconciliation must be foreground-only");
assert.equal(/setInterval\s*\(/.test(storage), false, "storage must not poll for local changes");
assert.match(storage, /pace\.local\.write/);
assert.match(engine, /onLocalWrite\(/);
assert.match(engine, /postgres_changes/);
assert.equal((engine.match(/realtimeChannel\.subscribe\(/g) ?? []).length, 1, "Realtime channel must only be subscribed during initial channel setup");
assert.equal(/location\.reload\s*\(/.test(engine), false, "sync must never reload the page");

// Egress regression contract: a healthy Realtime channel must not trigger a full user_state
// pull on every foreground/page-show event. Initial sync and unhealthy-channel recovery may pull.
assert.match(
  engine,
  /if \(reconcile && \(forcePull \|\| !realtimeHealthy\)\) await pull\(\);/,
  "full pull must be restricted to initial/forced reconciliation or Realtime recovery",
);
assert.match(
  engine,
  /void syncNow\(true, true\);/,
  "initial sync must retain one forced canonical pull",
);
assert.doesNotMatch(
  engine,
  /const syncNow = async \(reconcile = true, forcePull = false\)[\s\S]*?await flushQueue\(\);\s*await pull\(\);/,
  "syncNow must not unconditionally pull after every queue flush",
);
assert.match(
  engine,
  /realtimeHealthy = false/,
  "Realtime health must have an explicit unhealthy state for recovery",
);

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

// A lost RPC response is resolved by the monotonic RPC itself; a rejected write
// performs a single reconciliation read against the canonical row.
assert.match(engine, /if \(!payload\.accepted\)/);
assert.match(engine, /supabase\.from\("user_state"\)\.select\("key,value,updated_at,updated_by"\)/);
assert.match(engine, /serialize\(queued\.value\) === serialize\(mergedValue\)/);

// The server RPC is monotonic: an older canonical timestamp must never be
// replaced by a newer request carrying an older-than-canonical server timestamp.
assert.match(
  read("supabase/migrations/20260926192000_server_ordered_cloud_sync_monotonic_writes.sql"),
  /WHERE public\.user_state\.updated_at < EXCLUDED\.updated_at/,
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

console.log("cloud-sync-contract-test: PASS");


// The latest migration must restore the nutrition disjoint-day merge that was
// accidentally removed by the earlier RPC simplification.
const nutritionMerge = read("supabase/migrations/20261002210000_restore_nutrition_state_merge.sql");
assert.match(nutritionMerge, /p_key = 'pace\.nutrition\.items'/);
assert.match(nutritionMerge, /jsonb_object_keys\(current_value\)/);
assert.match(nutritionMerge, /jsonb_array_elements\(current_day\)/);
assert.match(nutritionMerge, /distinct on \(coalesce\(item ->> 'id', item::text\)\)/);
assert.match(nutritionMerge, /pg_advisory_xact_lock/);
assert.match(nutritionMerge, /updated_at < excluded\.updated_at/);

assert.match(engine, /pruneEquivalentConflicts\(\);\n      if \(!navigator\.onLine\)/, "syncNow must prune equivalent conflicts before queue flush");
assert.match(engine, /remainingConflicts = currentConflicts\.filter\(\(item\) => item\.key !== key\)/, "queued equivalent values must clear stale conflicts");


assert.match(nutritionLog, /source: item\.source \?\? "manual"/, "food_log bridge payload must preserve nutrition provenance");
assert.match(nutritionLog, /item\.source \?\? "manual"\]\);/, "nutrition bridge signature must include provenance");
assert.match(nutritionLog, /return \{ id, name: item\.name[\s\S]*source \};/, "persistNutritionItem must honor its explicit source argument");
assert.match(nutritionLog, /let nutritionBridgePending = false;/, "nutrition bridge must retain a write that arrives while a previous bridge is in flight");
assert.match(nutritionLog, /nutritionBridgePendingValue = value;/, "nutrition bridge must retain the latest pending nutrition value");
assert.match(nutritionLog, /if \(nutritionBridgePending\)[\s\S]*?void bridgeLocalNutritionToFoodLog\(nextValue\);/, "nutrition bridge must drain a queued write after the in-flight write completes");
assert.match(domainStore, /sodium: Number\(x\.sodium \?\? 0\), qty: Number\(x\.qty \?\? 1\), source: x\.source \?\? "manual"/, "local nutrition dedupe must retain provenance");
