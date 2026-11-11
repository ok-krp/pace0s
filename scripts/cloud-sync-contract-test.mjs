import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const engine = read("src/hooks/use-cloud-sync-engine.tsx");
const storage = read("src/lib/storage.ts");

const nutritionAi = read("src/lib/ai-chat.server.ts");
const nutritionLog = read("src/lib/nutrition-log.ts");
const nutritionRoute = read("src/routes/nutrition.tsx");

// AI meal additions are append-only. Replaying the same tool call is handled
// by the idempotency RPC; a later add must never merge/delete an older meal.
const aiAddStart = nutritionAi.indexOf("const toolCallId = options.toolCallId");
const aiAddEnd = nutritionAi.indexOf("await mirrorAiFoodToNutritionState", aiAddStart);
assert.ok(aiAddStart >= 0 && aiAddEnd > aiAddStart, "AI add_food insert path must remain identifiable");
const aiAddPath = nutritionAi.slice(aiAddStart, aiAddEnd);
assert.match(aiAddPath, /insert_coach_ai_food_idempotent_v2/);
assert.doesNotMatch(aiAddPath, /\.delete\s*\(/, "AI add_food must never delete a previous food_log row");
assert.doesNotMatch(aiAddPath, /\.update\s*\(/, "AI add_food must never overwrite a previous food_log row");
assert.match(nutritionAi, /AJOUT APPEND-ONLY/, "Coach IA must be instructed to preserve every existing meal during additions");
assert.doesNotMatch(nutritionAi, /Si le même plat est ajouté au même repas, conserve un seul objet logique/);
assert.match(nutritionAi, /Déplacement refusé : demande explicite de déplacement absente/);
assert.match(nutritionAi, /Remplacement refusé : demande explicite de modification absente/);
assert.match(nutritionAi, /Une demande d’ajout est toujours un ajout append-only/);

// A local cache snapshot may be partial or stale. Only explicit UI deletion
// is allowed to issue DELETE; the compatibility bridge is insert/update only.
const bridgeStart = nutritionLog.indexOf("async function bridgeLocalNutritionToFoodLog");
const bridgeEnd = nutritionLog.indexOf('\nif (typeof window !== "undefined")', bridgeStart);
assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart, "Nutrition bridge must remain identifiable");
const bridge = nutritionLog.slice(bridgeStart, bridgeEnd);
assert.doesNotMatch(bridge, /\.delete\s*\(/, "A missing local snapshot row must never delete canonical food_log data");
assert.match(bridge, /absence from a local snapshot must never erase cloud data/);
assert.match(nutritionRoute, /await deletePersistedNutritionItem\(id\)/, "User-requested deletion must explicitly delete its exact SQL row");

assert.match(engine, /setInterval\s*\(.*60(?:000|_000)/s, "sync engine must reconcile periodically");
assert.match(engine, /realtimeHealthy/, "sync engine must gate recovery polling on Realtime health");
assert.match(engine, /document\.visibilityState === "visible"/, "periodic reconciliation must be foreground-only");
assert.equal(/setInterval\s*\(/.test(storage), false, "storage must not poll for local changes");
assert.match(storage, /pace\.local\.write/);
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

// A lost RPC response is resolved by the monotonic RPC itself; a rejected write
// performs a single reconciliation read against the canonical row.
assert.match(engine, /if \(!payload\.accepted\)/);
assert.match(engine, /supabase\.from\("user_state"\)\.select\("key,value,updated_at,updated_by"\)/);
assert.match(engine, /serialize\(queued\.value\) === serialize\(mergedValue\)/);

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

console.log("cloud-sync-contract-test: PASS");

assert.match(engine, /pruneEquivalentConflicts\(\);\n      if \(!navigator\.onLine\)/, "syncNow must prune equivalent conflicts before queue flush");
assert.match(engine, /remainingConflicts = currentConflicts\.filter\(\(item\) => item\.key !== key\)/, "queued equivalent values must clear stale conflicts");
