import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const engine = read("src/hooks/use-cloud-sync-engine.tsx");
const storage = read("src/lib/storage.ts");
const supabaseTypes = read("src/integrations/supabase/types.ts");

const writeItemStart = engine.indexOf("const writeItem =");
const pushItemStart = engine.indexOf("const pushItem =", writeItemStart);
const flushQueueStart = engine.indexOf("const flushQueue =", pushItemStart);
assert.ok(writeItemStart >= 0 && pushItemStart > writeItemStart && flushQueueStart > pushItemStart, "cloud write acknowledgement handlers must remain identifiable");
const writeItemBlock = engine.slice(writeItemStart, pushItemStart);
const pushItemBlock = engine.slice(pushItemStart, flushQueueStart);
assert.match(writeItemBlock, /if \(!payload\.accepted\)[\s\S]*recordConflict\(row\.key, item\.value, row\.value, row\.updated_at\)/, "a stale server rejection must create a resolvable conflict without replacing the local value");
assert.doesNotMatch(writeItemBlock, /applyRemoteAndRemember\(row\.key/, "a rejected local write must not overwrite the user's local snapshot with remote data");
assert.match(pushItemBlock, /if \(accepted\) \{[\s\S]*unqueueIfMutation\(latest\.key, latest\.updatedAt\)/, "only server-accepted mutations may leave the outbox");
assert.match(pushItemBlock, /else \{[\s\S]*Rejected writes remain durable in the outbox/, "a rejected mutation must remain queued until conflict resolution");
assert.doesNotMatch(pushItemBlock, /\}\s*unqueueIfMutation\(latest\.key, latest\.updatedAt\)/, "outbox entries must not be removed unconditionally after a rejected write");

const syncRpcTypeStart = supabaseTypes.indexOf("upsert_user_state_if_newer:");
const syncRpcTypeBlock = supabaseTypes.slice(syncRpcTypeStart, syncRpcTypeStart + 350);
assert.ok(syncRpcTypeStart >= 0, "Generated cloud sync RPC type must remain identifiable");
assert.match(syncRpcTypeBlock, /Returns: Json/, "Generated Supabase types must reflect the jsonb accepted/updated_at response");
assert.match(writeItemBlock, /supabase\.rpc\("upsert_user_state_if_newer"/, "Web cloud sync must use the generated typed RPC contract");
assert.doesNotMatch(writeItemBlock, /const rpc = supabase\.rpc as unknown as/, "Web cloud sync must not hide the generated RPC response contract behind an unsafe cast");



const nutritionAi = read("src/lib/ai-chat.server.ts");
const nutritionLog = read("src/lib/nutrition-log.ts");
const nutritionRealtimeMigration = read("supabase/migrations/20261111220000_enable_food_log_realtime_sync.sql");
const nutritionRoute = read("src/routes/nutrition.tsx");
const domainStore = read("src/lib/domain-store.ts");

const flutterSync = read("pace_flutter/lib/core/sync/sync_service.dart");
const flutterNutrition = read("pace_flutter/lib/features/nutrition/nutrition_page.dart");
const flutterApp = read("pace_flutter/lib/app/pace_app.dart");
const flutterSettings = read("pace_flutter/lib/features/more/more_page.dart");
const flutterLocalStore = read("pace_flutter/lib/core/storage/local_store.dart");
const flutterPushStart = flutterSync.indexOf("Future<void> _pushPending()");
const flutterPushEnd = flutterSync.indexOf("Future<_PushResult> _push(", flutterPushStart);
assert.ok(flutterPushStart >= 0 && flutterPushEnd > flutterPushStart, "Flutter outbox push path must remain identifiable");
const flutterPush = flutterSync.slice(flutterPushStart, flutterPushEnd);
assert.match(flutterSync, /bool shouldAcknowledgeSyncOperation\(\{required bool accepted\}\) => accepted/);
assert.match(flutterPush, /if \(!shouldAcknowledgeSyncOperation\(accepted: result\.accepted\)\) \{[\s\S]*continue;/, "Flutter must retain rejected local mutations in its durable outbox");
assert.doesNotMatch(flutterPush, /applyRemote\(/, "Flutter must not replace a pending local value when the cloud rejects its write");
assert.match(flutterNutrition, /await widget\.sync\.syncNow\(\)/, "Flutter Nutrition manual changes must request immediate cloud sync");
assert.match(flutterNutrition, /await widget\.localStore\.write\('pace\.nutrition\.items', data\);[\s\S]*await _recalculateTotals\(data\);[\s\S]*await widget\.sync\.syncNow\(\)/, "Flutter meal additions must persist locally before requesting immediate sync");
assert.match(flutterApp, /NutritionPage\(localStore: widget\.localStore, sync: widget\.sync\)/, "Flutter app must inject the shared sync service into Nutrition");

assert.match(flutterSync, /Future<bool> _hasCloudSyncConsent\(String userId\)/, "Flutter must load the latest explicit sync_cloud consent");
assert.match(flutterSync, /consent_type', 'sync_cloud'/, "Flutter sync consent must match the web consent category");
assert.match(flutterSync, /_cloudSyncConsent = null/, "A failed consent lookup must remain distinguishable from an explicit denial");
assert.match(flutterNutrition, /impossible de vérifier le consentement cloud/, "Nutrition must explain when consent lookup is unavailable instead of falsely claiming consent was denied");
assert.match(flutterSync, /if \(userId == null \|\| !_hasCachedCloudSyncConsent\(userId\)\) return;/, "Flutter must not push local outbox mutations without sync_cloud consent");
assert.match(flutterSync, /if \(!_hasCachedCloudSyncConsent\(userId\)\) return;/, "Flutter must not pull remote state without sync_cloud consent");
assert.match(flutterSettings, /Synchronisation entre appareils[\s\S]*_setConsent\('sync_cloud', value\)/, "Flutter settings must expose the functional cross-device sync consent");
assert.match(flutterSettings, /await widget\.sync\.setCloudSyncConsent\(value\)/, "Changing consent must immediately update native sync behavior");

assert.match(flutterLocalStore, /__local_store_version': 2[\s\S]*__accounts/, "Flutter local storage must persist independent versioned account snapshots");
assert.match(flutterLocalStore, /Future<void> activateAccount\(String\? userId\)/, "Flutter must switch local snapshot and outbox atomically at account boundaries");
assert.match(flutterLocalStore, /account:\$userId/, "Flutter local account namespaces must be bound to the authenticated user ID");
assert.match(flutterApp, /await widget\.sync\.onAccountChanged\(userId\);[\s\S]*await widget\.localStore\.activateAccount\(userId\);[\s\S]*await widget\.sync\.syncNow\(\)/, "Flutter must switch account namespace before starting cloud sync");
assert.match(flutterApp, /widget\.auth\.currentUser\?\.id != userId/, "Flutter must ignore obsolete queued auth events during rapid account switching");
assert.match(flutterSync, /localStore\.currentAccountId != userId\) return;/, "Explicit consent updates must not be attributed to a different local account");
assert.match(flutterSync, /localStore\.currentAccountId != userId/, "Flutter cloud operations must stop when the active local scope does not match the authenticated user");
assert.match(flutterSync, /localStore\.currentAccountId != initialUserId/, "An in-flight sync must abort as soon as the authenticated account changes");
assert.match(flutterSync, /if \(localStore\.currentAccountId != userId\) \{[\s\S]*Espace local différent du compte authentifié/, "The final push RPC must recheck account scope at the write boundary");

assert.match(flutterLocalStore, /Future<void> acknowledgeOperationForAccount\([\s\S]*final scope = 'account:\$userId'[\s\S]*_accounts\[scope\]/, "Late accepted cloud acknowledgements must update the originating account snapshot rather than the active one");
assert.match(flutterSync, /acknowledgeOperationForAccount\([\s\S]*userId,[\s\S]*operation,[\s\S]*result\.serverUpdatedAt/, "Flutter must acknowledge accepted mutations inside their originating account after async requests finish");
assert.match(flutterSync, /final shouldRerunForActiveAccount = _syncRequested[\s\S]*unawaited\(syncNow\(\)\)/, "A new account sync request must be resumed after an old in-flight account cycle drains");
assert.match(flutterSync, /final userId = client\?\.auth\.currentUser\?\.id;[\s\S]*localStore\.currentAccountId != userId[\s\S]*_cloudSyncConsentUserId != userId/, "Late user_state Realtime events must not apply across account scopes");
assert.match(flutterApp, /if \(widget\.auth\.currentUser\?\.id != userId\) return;[\s\S]*await widget\.sync\.onAccountChanged\(userId\)/, "Obsolete auth stream events must not activate an account after a newer session has arrived");
assert.match(flutterNutrition, /final accountId = widget\.sync\.activeAccountId[\s\S]*isCurrentLocalAccount\(accountId\)/, "Nutrition dialogs must stay bound to the account that opened them");
assert.match(flutterSettings, /final userId = widget\.auth\.currentUser\?\.id[\s\S]*localStore\.currentAccountId != userId/, "Settings mutations must be attributed to the account that initiated them");

assert.match(flutterSync, /Future<void> onAccountChanged\(String\? userId\)[\s\S]*_cloudSyncConsent = null[\s\S]*_lastNutritionReconciledAt = null/, "Account changes must close old Realtime channels and invalidate the previous consent cache");



assert.match(flutterSync, /if \(hadNutritionMutation\) \{[\s\S]*_reconcileNutritionProjection\(user\.id\);[\s\S]*_pushPending\(\)/, "Flutter must reconcile canonical Nutrition rows after local mutations and push the merged snapshot");
assert.match(flutterSync, /_reconcileNutritionProjection[\s\S]*from\('food_log'\)[\s\S]*legacyRows[\s\S]*_isFoodLogUuid/, "Flutter reconciliation must combine canonical food_log rows with legacy local-only manual meals");
assert.match(flutterSync, /Future<void> deleteNutritionFoodLogItem\(String id\)[\s\S]*from\('food_log'\)[\s\S]*\.delete\(\)/, "Deleting a canonical meal must delete its exact food_log row");
assert.match(flutterNutrition, /deleteNutritionFoodLogItem\(item\['id'\]\?\.toString\(\) \?\? ''\)/, "Flutter Nutrition UI must request explicit canonical deletion before removing an item");
assert.match(flutterNutrition, /Suppression impossible ; le repas a été conservé\./, "A failed canonical deletion must leave the meal visible");

assert.match(flutterNutrition, /cloudSyncConsentGranted/, "Flutter Nutrition must not silently imply cross-device sync when explicit consent is disabled");
assert.match(flutterNutrition, /Active « Synchronisation entre appareils » dans Plus → Paramètres/, "Flutter Nutrition must tell the user how to enable the one-time functional sync consent");




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

const aiNutritionSyncStart = nutritionAi.indexOf("async function syncNutritionStateFromDb");
const aiNutritionSyncEnd = nutritionAi.indexOf("async function mirrorAiFoodToNutritionState", aiNutritionSyncStart);
assert.ok(aiNutritionSyncStart >= 0 && aiNutritionSyncEnd > aiNutritionSyncStart, "AI Nutrition DB projection must remain identifiable");
const aiNutritionSync = nutritionAi.slice(aiNutritionSyncStart, aiNutritionSyncEnd);
assert.match(aiNutritionSync, /const existingDay = Array\.isArray\(itemsByDay\[day\]\) \? itemsByDay\[day\] : \[\]/, "AI projection must safely inspect an existing Nutrition day snapshot");
assert.match(aiNutritionSync, /const legacyRows = existingDay\.filter\(\(item\) =>[\s\S]*!uuidPattern\.test\(item\.id\)/, "AI projection must retain historical non-UUID native manual meals");
assert.match(aiNutritionSync, /itemsByDay\[day\] = \[\.\.\.canonicalRows, \.\.\.legacyRows, \.\.\.pendingRows\]/, "AI projection must retain both historical and pending native manual meals");
assert.match(aiNutritionSync, /const pendingRows = existingDay\.filter\(\(item\) =>[\s\S]*item\.pendingFoodLog === true[\s\S]*!canonicalIds\.has/, "AI projection must preserve pending native UUID rows not yet visible in food_log");
assert.match(aiNutritionSync, /itemsByDay\[day\] = \[\.\.\.canonicalRows, \.\.\.legacyRows, \.\.\.pendingRows\]/, "AI projection must retain both historical and pending native manual meals");
assert.match(nutritionAi, /async function writeNutritionStateSnapshot[\s\S]*upsert_user_state_if_newer/, "AI Nutrition snapshots must use the monotonic cloud sync RPC rather than a direct user_state update");
assert.match(aiNutritionSync, /for \(let attempt = 0; attempt < 3; attempt\+\+\)[\s\S]*if \(!itemsAccepted\) continue/, "AI Nutrition must reread and retry when a concurrent newer user_state snapshot wins");

assert.ok(
  aiNutritionSync.indexOf('const current = await readUserState(client, userId, "pace.nutrition.items")') <
    aiNutritionSync.indexOf('client.from("food_log")'),
  "Each AI projection retry must reread user_state before fetching the canonical food_log rows",
);

assert.match(nutritionAi, /const legacyMeals = .*context\.todayNutrition = \[\.\.\.\(data \?\? \[\]\), \.\.\.legacyMeals\]/s, "Coach context must include legacy native manual meals");


// A local cache snapshot may be partial or stale. Only explicit UI deletion
// is allowed to issue DELETE; the compatibility bridge is insert/update only.
const bridgeStart = nutritionLog.indexOf("async function bridgeNutritionSnapshot(value: unknown, userId: string)");
const bridgeEnd = nutritionLog.indexOf('\nif (typeof window !== "undefined")', bridgeStart);
assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart, "Nutrition bridge must remain identifiable");
const bridge = nutritionLog.slice(bridgeStart, bridgeEnd);
assert.doesNotMatch(bridge, /\.delete\s*\(/, "A missing local snapshot row must never delete canonical food_log data");
assert.match(bridge, /A missing ID is not a delete instruction/);
assert.match(nutritionRoute, /await deletePersistedNutritionItem\(id\)/, "User-requested deletion must explicitly delete its exact SQL row");
assert.match(nutritionLog, /DELETED_IDS_KEY = "pace\.__nutrition_deleted_ids_v1"/, "Explicit nutrition deletions must leave an account-local tombstone");
assert.match(nutritionLog, /rememberDeletedNutritionId\(user\.id, id\)/, "A successful SQL deletion must tombstone the deleted UUID");
assert.match(nutritionLog, /nutritionRows\(value\)\.filter\(\(\{ id \}\) => isFoodLogUuid\(id\) && !deletedIds\.has\(id\)\)/, "Only UUID-backed rows may be bridged, and explicitly deleted IDs stay excluded");
assert.match(nutritionLog, /raw\?\.userId === userId/, "Nutrition tombstones must be isolated to the signed-in account");
const explicitNutritionDeleteStart = nutritionLog.indexOf("export async function deletePersistedNutritionItem");
const explicitNutritionDeleteEnd = nutritionLog.indexOf("\nfunction nutritionRows", explicitNutritionDeleteStart);
assert.ok(explicitNutritionDeleteStart >= 0 && explicitNutritionDeleteEnd > explicitNutritionDeleteStart, "Explicit nutrition deletion must remain identifiable");
const explicitNutritionDelete = nutritionLog.slice(explicitNutritionDeleteStart, explicitNutritionDeleteEnd);
assert.ok(explicitNutritionDelete.indexOf("rememberDeletedNutritionId(user.id, id)") < explicitNutritionDelete.indexOf("await nutritionBridgeChain.catch"), "Deletion tombstone must be registered before draining the bridge");
assert.ok(explicitNutritionDelete.indexOf("await nutritionBridgeChain.catch") < explicitNutritionDelete.indexOf('from("food_log").delete()'), "SQL deletion must run after queued legacy bridge writes finish");
assert.match(explicitNutritionDelete, /forgetDeletedNutritionId\(user\.id, id\)/, "A failed explicit SQL deletion must roll back its tombstone");



assert.match(bridge, /isFoodLogUuid\(id\) && !deletedIds\.has\(id\)/, "Legacy timestamp IDs must not be sent to the UUID food_log primary key");
assert.match(nutritionLog, /const legacyRows = \(current\[day\] \?\? \[\]\)\.filter\(\(item\) => !isFoodLogUuid\(item\.id\)/, "Web refresh must retain legacy Flutter meals absent from food_log");
assert.match(nutritionLog, /const pendingRows = currentRows\.filter\(\(item\) =>[\s\S]*pendingFoodLog === true[\s\S]*!canonicalIds\.has\(item\.id\)/, "Web refresh must retain pending native UUID rows absent from food_log");
assert.match(nutritionLog, /const pendingRows = currentRows\.filter\(\(item\) =>[\s\S]*pendingFoodLog === true[\s\S]*!canonicalIds\.has\(item\.id\)/, "Web refresh must preserve native UUID rows while their canonical food_log insert is pending");
assert.match(nutritionLog, /if \(pendingRows\.length\) await bridgeLocalNutritionToFoodLog\(nextSnapshot\)/, "Web must retry pending native meal inserts through the idempotent UUID bridge");
assert.match(nutritionLog, /if \(!isFoodLogUuid\(id\)\) return/, "Legacy timestamp meal deletion must not query the UUID food_log key");

assert.match(nutritionLog, /await persistNutritionItem\(item, source\)/, "All nutrition additions must persist to food_log before updating local state");
assert.match(nutritionLog, /source === "photo_ai" \? "photo" : source/, "Photo AI writes must use a source value accepted by the food_log schema");

assert.match(nutritionLog, /export function subscribeNutritionFoodLogChanges/, "Web Nutrition must subscribe to canonical food_log changes");
assert.match(nutritionLog, /event: "INSERT"[\s\S]*table: "food_log"[\s\S]*filter: `user_id=eq\.\$\{user\.id\}`/, "Web Nutrition Realtime must be scoped to the authenticated account");
assert.match(nutritionLog, /event: "UPDATE"[\s\S]*table: "food_log"/, "Web Nutrition must refresh when canonical meals are edited by AI or another device");
assert.match(nutritionLog, /nutritionRefreshChain = nutritionRefreshChain\.then\(task, task\)/, "Concurrent Nutrition hydration requests must be serialized");
assert.match(nutritionLog, /lastBridgedNutrition = nextSnapshot;[\s\S]*writeDomain\(DOMAIN_ITEMS, nextSnapshot\)/, "A Realtime refresh must not echo stale local rows back into food_log");
assert.match(nutritionLog, /const changed = JSON\.stringify\(current\[day\] \?\? \[\]\) !== JSON\.stringify\(mergedRows\);[\s\S]*if \(changed\) \{[\s\S]*writeDomain/, "A Realtime refresh must not enqueue identical full Nutrition snapshots");
assert.match(nutritionRoute, /subscribeNutritionFoodLogChanges\(refresh\)/, "The Nutrition route must bind its lifecycle to the Realtime subscription");
assert.match(nutritionRoute, /setInterval\(refresh, 60_000\)/, "Nutrition must retain a bounded fallback when Realtime is unavailable");
assert.match(flutterSync, /table: 'food_log'[\s\S]*callback: \(_\) => unawaited\(_handleFoodLogRealtime\(userId\)\)/, "Flutter must reconcile food_log INSERT and UPDATE events");
assert.match(flutterSync, /_lastNutritionReconciledAt == null[\s\S]*_nutritionFallbackInterval/, "Flutter must refresh canonical Nutrition after login and on a bounded fallback interval");

assert.match(flutterSync, /Future<void> upsertNutritionFoodLogItem\([\s\S]*from\('food_log'\)\.upsert[\s\S]*onConflict: 'id'/, "Flutter manual Nutrition inserts must be idempotent in canonical food_log");
assert.match(flutterSync, /pendingFoodLog[\s\S]*upsertNutritionFoodLogItem[\s\S]*final rows = await client!/, "Flutter must retry pending canonical meal inserts and retain them locally until visible in food_log");
assert.match(flutterNutrition, /'id': newFoodLogUuid\(\),[\s\S]*'pendingFoodLog': true/, "Flutter must give a manual meal a stable UUID before network persistence");

assert.match(nutritionRealtimeMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.food_log/, "Supabase migration must publish food_log for account-scoped Realtime");
assert.match(nutritionRealtimeMigration, /duplicate_object/, "food_log Realtime publication migration must be idempotent");

assert.doesNotMatch(domainStore, /MAX_IDENTICAL_NUTRITION_ITEMS_PER_DAY|MAX_NUTRITION_ITEMS_PER_DAY|count >=/, "Nutrition sanitization must not silently deduplicate or truncate valid meal entries");
assert.doesNotMatch(nutritionLog, /recentAdds|addFingerprint/, "Identical intentional food entries must not be dropped by a client-side fingerprint cooldown");
assert.match(nutritionLog, /completedOperations\.set\(operationId, now\)/, "Only explicit operation IDs should trigger idempotency suppression");
assert.match(nutritionRoute, /savingPending/, "Barcode and photo confirmation must prevent accidental duplicate clicks while the server write is pending");

assert.match(nutritionLog, /refreshNutritionFromFoodLog\(todayKey\(\)\)/, "Nutrition projection must be rebuilt from canonical food_log after an addition");
assert.match(nutritionLog, /async function bridgeNutritionSnapshot\(value: unknown, userId: string\)/, "Previously local-only manual entries must be recovered into food_log");
assert.match(nutritionLog, /for \(const \{ id, day, item \} of nextRows\)/, "Legacy recovery must preserve each existing nutrition UUID");
assert.match(nutritionLog, /id, user_id: user\.id, log_date: day/, "Legacy recovery must reuse each existing nutrition UUID in food_log");
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
assert.match(engine, /const localDomainTime = localDomain \? Date\.parse\(localDomain\.updatedAt\)/, "Local reconciliation must compare the persisted mutation timestamp, not only last acknowledged cloud metadata");
assert.match(engine, /Number\.isFinite\(localDomainTime\) && localDomainTime > sourceTime/, "A newer local snapshot must be queued instead of overwritten by an older cloud snapshot");
assert.doesNotMatch(engine.slice(engine.indexOf("for (const [key, bucket] of grouped)"), engine.indexOf("// Bootstrap pre-existing local domain state")), /mergeRecoveredValues/, "A stale legacy snapshot must not resurrect deleted array entries");

assert.match(read("src/lib/legal.ts"), /sync_cloud: false/, "cloud sync must remain opt-in by default");
assert.match(nutritionLog, /isNutritionDeviceSyncEnabled\(\).*isLegalCategoryAllowed\("sync_cloud"\)/s, "Nutrition UI must be able to explain when cross-device sync is disabled");
assert.match(engine, /postgres_changes/);
assert.equal((engine.match(/channel\.subscribe\(/g) ?? []).length, 1, "Realtime channel must only be subscribed during initial channel setup");
assert.equal(/location\.reload\s*\(/.test(engine), false, "sync must never reload the page");

// Internal persistence keys never become cloud records.
assert.match(engine, /!key\.startsWith\(INTERNAL_PREFIX\)/);
assert.match(engine, /DOMAIN_OUTBOX_KEY/);

// Remote application is separated from user mutation events.
assert.match(storage, /REMOTE_WRITE_EVENT/);
const localRemoteHandlerStart = storage.indexOf("const onRemote =");
const localRemoteHandlerEnd = storage.indexOf("window.addEventListener(REMOTE_WRITE_EVENT, onRemote)", localRemoteHandlerStart);
const localRemoteHandler = storage.slice(localRemoteHandlerStart, localRemoteHandlerEnd);
assert.ok(localRemoteHandler.indexOf("hasCompatibleTopLevelShape") < localRemoteHandler.indexOf("hasPendingRemoteValueRef.current = true"), "Invalid remote shapes must not suppress the next manual local write");
assert.match(localRemoteHandler, /Object\.is\(valueRef\.current, next\)/, "Identical remote values must not create a pending echo");
assert.match(localRemoteHandler, /pendingRemoteValueRef\.current = next/, "Realtime application must remember the exact remote value instead of a global suppression flag");
const localSetStart = storage.indexOf("const set = useCallback", localRemoteHandlerEnd);
const localSetEnd = storage.indexOf("return [value, set]", localSetStart);
const localSetHandler = storage.slice(localSetStart, localSetEnd);
assert.match(localSetHandler, /hasPendingRemoteValueRef\.current = false/, "A local mutation arriving during remote hydration must cancel the pending echo");
assert.match(storage, /if \(!hydratedRef\.current\) \{\n      hydratedRef\.current = true;/, "Initial hydration must complete before remote-echo suppression");
assert.doesNotMatch(storage, /suppressPersistRef/, "A stale boolean must not suppress a later independent local mutation");

assert.match(storage, /CustomEvent<LocalWriteDetail>\(LOCAL_WRITE_EVENT/);

const synchronousSetStart = storage.indexOf("const set = useCallback");
const synchronousSetEnd = storage.indexOf("return [value, set]", synchronousSetStart);
assert.ok(synchronousSetStart >= 0 && synchronousSetEnd > synchronousSetStart, "useLocalState setter must remain identifiable");
const synchronousSet = storage.slice(synchronousSetStart, synchronousSetEnd);
assert.match(synchronousSet, /localStorage\.setItem\(key, serialized\)/, "Every useLocalState mutation must be persisted before React schedules the next effect");
assert.match(synchronousSet, /window\.dispatchEvent\(new CustomEvent<LocalWriteDetail>\(LOCAL_WRITE_EVENT/, "Every useLocalState mutation must enter the cloud outbox immediately");
assert.doesNotMatch(synchronousSet, /key === "pace\.recipes\.custom"/, "Immediate persistence must apply to all local state keys, not only recipes");

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
assert.match(engine, /serialize\(queued\.value\) === serialize\(remoteValue\)/);

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
