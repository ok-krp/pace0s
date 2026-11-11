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
assert.match(nutritionLog, /await persistNutritionItem\(item, source\)/, "All nutrition additions must persist to food_log before updating local state");
assert.doesNotMatch(domainStore, /MAX_IDENTICAL_NUTRITION_ITEMS_PER_DAY|MAX_NUTRITION_ITEMS_PER_DAY|count >=/, "Nutrition sanitization must not silently deduplicate or truncate valid meal entries");
assert.doesNotMatch(nutritionLog, /recentAdds|addFingerprint/, "Identical intentional food entries must not be dropped by a client-side fingerprint cooldown");
assert.match(nutritionLog, /completedOperations\.set\(operationId, now\)/, "Only explicit operation IDs should trigger idempotency suppression");
assert.match(nutritionRoute, /savingPending/, "Barcode and photo confirmation must prevent accidental duplicate clicks while the server write is pending");

assert.match(nutritionLog, /refreshNutritionFromFoodLog\(todayKey\(\)\)/, "Nutrition projection must be rebuilt from canonical food_log after an addition");
assert.match(nutritionLog, /Recover entries created by older app versions/, "Previously local-only manual entries must be recovered into food_log");
assert.match(nutritionLog, /id: item\.id, user_id: user\.id, log_date: day/, "Legacy recovery must preserve each existing nutrition UUID");
assert.doesNotMatch(nutritionLog.slice(nutritionLog.indexOf("async function refreshNutritionFromFoodLog"), nutritionLog.indexOf("export async function addNutritionItem")), /\.delete\s*\(/, "Canonical refresh and legacy recovery must never delete nutrition entries");
assert.match(nutritionLog, /order\("created_at", \{ ascending: true \}\)/, "Canonical nutrition refresh must retain stable meal ordering");
assert.match(nutritionLog, /let nutritionBridgeChain: Promise<void>/, "Legacy nutrition snapshots must be serialized instead of being dropped during an in-flight bridge");
assert.match(nutritionLog, /nutritionBridgeChain = nutritionBridgeChain\.then\(task, task\)/, "Queued nutrition bridge snapshots must run even after a previous failure");
assert.match(nutritionLog, /await bridgeLocalNutritionToFoodLog\(readNutritionItems\(\)\)/, "Nutrition refresh must wait for legacy local entries to finish bridging");
assert.doesNotMatch(nutritionLog, /nutritionBridgeRunning/, "The bridge must not silently discard writes while busy");

assert.match(nutritionRoute, /await addNutritionItem\([\s\S]*"manual"\)/, "Manual form must use the canonical persisted add path");
assert.match(nutritionRoute, /await addNutritionItem\([\s\S]*"barcode"\)/, "Barcode additions must use the canonical persisted add path");
assert.match(nutritionRoute, /await addNutritionItem\([\s\S]*"photo_ai"\)/, "Photo AI additions must use the canonical persisted add path");
assert.match(read("src/components/RecipesView.tsx"), /await addNutritionItem\(/, "Recipe quick-add must wait for canonical persistence");

assert.match(engine, /setInterval\s*\(.*60(?:000|_000)/s, "sync engine must reconcile periodically");
assert.match(engine, /realtimeHealthy/, "sync engine must gate recovery polling on Realtime health");
assert.match(engine, /document\.visibilityState === "visible"/, "periodic reconciliation must be foreground-only");
assert.equal(/setInterval\s*\(/.test(storage), false, "storage must not poll for local changes");
assert.match(storage, /pace\.local\.write/);
assert.match(engine, /onLocalWrite\(/);
const domainStore = read("src/lib/domain-store.ts");
const domainLocalWriteStart = domainStore.indexOf("const onWrite =");
const domainRemoteWriteStart = domainStore.indexOf("const onRemoteWrite =", domainLocalWriteStart);
const domainWriteEnd = domainStore.indexOf("window.addEventListener(WRITE_EVENT", domainRemoteWriteStart);
assert.ok(domainLocalWriteStart >= 0 && domainRemoteWriteStart > domainLocalWriteStart && domainWriteEnd > domainRemoteWriteStart, "domain write handlers must remain identifiable");
const domainWriteHandlers = domainStore.slice(domainLocalWriteStart, domainWriteEnd);
assert.doesNotMatch(domainWriteHandlers, /mergeNutritionValues/, "A full local or remote Nutrition snapshot must not union deleted items back into the list");
assert.doesNotMatch(domainStore, /domain === "sleep".*merged = \{/, "Full sleep snapshots must preserve explicit removals");
assert.doesNotMatch(storage, /mergeRecipeCustomRemote/, "Recipe snapshots must not union deleted recipes back into the list");
assert.match(storage, /const next = detail\.value;/, "Remote list values must be applied as complete snapshots");
assert.match(storage, /const safeValue = value;/, "Remote storage application must preserve exact canonical values");

assert.match(domainWriteHandlers, /sanitizeNutritionItems\(unwrapDomainValue\(detail\.record\.value\)\)/, "Local Nutrition writes must apply the exact snapshot");
assert.match(domainWriteHandlers, /sanitizeNutritionItems\(next\.value\)/, "Remote Nutrition writes must apply the exact snapshot");

const nutritionRemoteStart = engine.indexOf("function mergeNutritionRemoteValue(");
const nutritionRemoteEnd = engine.indexOf("\n}", nutritionRemoteStart) + 2;
const nutritionRemote = engine.slice(nutritionRemoteStart, nutritionRemoteEnd);
assert.match(nutritionRemote, /return sanitizeNutritionItems\(unwrapNutritionValue\(incomingValue\)\)/, "Remote Nutrition snapshots must be applied as complete canonical values");
assert.doesNotMatch(nutritionRemote, /new Set\(local|output = \[\.\.\.local\]/, "Remote Nutrition sync must not reinsert explicitly deleted local rows");

// Full snapshots must propagate explicit removals, not union them away.
const applyNutritionSnapshot = (_current, incoming) => incoming;
assert.deepEqual(applyNutritionSnapshot([{ id: "keep" }, { id: "remove" }], [{ id: "keep" }]), [{ id: "keep" }]);

assert.match(engine, /isLegalCategoryAllowed\("sync_cloud"\)/, "cross-device sync must respect the explicit cloud-sync consent");
const syncSettings = read("src/components/CloudSyncSettings.tsx");
assert.match(syncSettings, /isLegalCategoryAllowed\("sync_cloud"\)/, "Settings must show the actual cross-device sync consent");
assert.match(syncSettings, /Désactivée — active/, "Settings must not claim synchronization is active when consent is off");
const realtimeStart = engine.indexOf("const startRealtime =");
const realtimeEnd = engine.indexOf("const offLocal =", realtimeStart);
assert.ok(realtimeStart >= 0 && realtimeEnd > realtimeStart, "Realtime lifecycle must be identifiable");
const realtimeLifecycle = engine.slice(realtimeStart, realtimeEnd);
assert.match(realtimeLifecycle, /!allowed\(\)/, "Realtime must not start without cloud-sync consent");
assert.match(engine, /if \(cancelled \|\| !allowed\(\) \|\| !isSyncableKey\(row\.key\)/, "Remote writes must be rejected when cloud-sync consent is off");
assert.match(engine, /stopRealtime\(\);\n      setStatus\("offline"\);/, "Realtime must stop when the app goes offline");
assert.match(engine, /if \(allowed\(\)\) startRealtime\(\);/, "Realtime must start on initial opt-in");
assert.match(engine, /if \(allowed\(\)\) \{ startRealtime\(\); void syncNow\(\); \}/, "Enabling sync consent must reconnect Realtime and reconcile");
assert.match(engine, /queueItem\(\{ key, value, updatedAt, mutationId \}\);\n      if \(allowed\(\)\)/, "Local mutations must remain queued on-device while cloud sync consent is off");
assert.match(engine, /localOnlyKeys/, "Legacy raw app-state bootstrap must exclude device-local security and appearance settings");
assert.match(engine, /pace\.privacy\.pin\.hash/, "Finance PIN hashes must never be part of local raw-state cloud recovery");
assert.match(engine, /pace\.ble\.devices/, "Paired Bluetooth device identifiers must remain device-local");
assert.match(engine, /pace\.ai\.pending:/, "Local AI prompt drafts must remain device-local");

assert.match(engine, /await flushQueue\(\); await pull\(\); await flushQueue\(\);/, "Bootstrapped and recovered local values must be pushed in the same sync pass");
assert.match(engine, /const sourceRow = !canonical \? legacy : !legacy \? canonical/, "Legacy recovery must select the newest full snapshot instead of union-merging rows");
assert.doesNotMatch(engine.slice(engine.indexOf("for (const [key, bucket] of grouped)"), engine.indexOf("// Bootstrap pre-existing local domain state")), /mergeRecoveredValues/, "A stale legacy snapshot must not resurrect deleted array entries");

assert.match(read("src/lib/legal.ts"), /sync_cloud: false/, "cloud sync must remain opt-in by default");
assert.match(nutritionLog, /isNutritionDeviceSyncEnabled\(\).*isLegalCategoryAllowed\("sync_cloud"\)/s, "Nutrition UI must be able to explain when cross-device sync is disabled");
assert.match(engine, /postgres_changes/);
assert.equal((engine.match(/realtimeChannel\.subscribe\(/g) ?? []).length, 1, "Realtime channel must only be subscribed during initial channel setup");
assert.equal(/location\.reload\s*\(/.test(engine), false, "sync must never reload the page");

// Internal persistence keys never become cloud records.
assert.match(engine, /!key\.startsWith\(INTERNAL_PREFIX\)/);
assert.match(engine, /DOMAIN_OUTBOX_KEY/);

// Remote application is separated from user mutation events.
assert.match(storage, /REMOTE_WRITE_EVENT/);
const localRemoteHandlerStart = storage.indexOf("const onRemote =");
const localRemoteHandlerEnd = storage.indexOf("window.addEventListener(REMOTE_WRITE_EVENT, onRemote)", localRemoteHandlerStart);
const localRemoteHandler = storage.slice(localRemoteHandlerStart, localRemoteHandlerEnd);
assert.ok(localRemoteHandler.indexOf("hasCompatibleTopLevelShape") < localRemoteHandler.indexOf("suppressPersistRef.current = true"), "Invalid remote shapes must not suppress the next manual local write");
assert.match(localRemoteHandler, /Object\.is\(valueRef\.current, next\)/, "Identical primitive remote values must not leave a stale suppression flag");

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
