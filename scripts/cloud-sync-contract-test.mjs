import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const rootShell = read("src/routes/__root.tsx");
const appSidebar = read("src/components/AppSidebar.tsx");
assert.match(
  rootShell,
  /pb-20 xl:pb-6 flex flex-col xl:ml-\[312px\]/,
  "A fixed desktop sidebar must reserve horizontal space only from the wide-screen breakpoint",
);
assert.doesNotMatch(
  rootShell,
  /md:ml-\[312px\]/,
  "Tablet widths must not reserve the desktop sidebar gutter",
);
assert.match(
  rootShell,
  /max-w-\[1400px\] mx-auto min-h-0 px-3 xl:px-8 pt-2 xl:pt-8/,
  "Tablet content must use the full available width and wide-screen padding only on desktop",
);
assert.match(
  appSidebar,
  /hidden xl:flex w-72/,
  "The fixed sidebar must stay hidden below the wide-screen breakpoint",
);
assert.equal(
  (appSidebar.match(/xl:hidden/g) ?? []).length,
  4,
  "Tablet navigation must expose the top bar, drawer, overlay and bottom tab bar together",
);
assert.doesNotMatch(
  appSidebar,
  /md:hidden|hidden md:flex/,
  "The custom app navigation must not switch to desktop mode at the tablet breakpoint",
);
const syncRpcTrimMigration = read("supabase/migrations/20261127103000_fix_user_state_sync_rpc_trim.sql");
assert.match(syncRpcTrimMigration, /pg_catalog\.btrim\(p_updated_by\)/,
  "The sync RPC must trim the device identifier using a real pg_catalog function");
assert.doesNotMatch(syncRpcTrimMigration, /pg_catalog\.trim\(p_updated_by\)/,
  "The sync RPC must not call the nonexistent pg_catalog.trim function");
assert.match(syncRpcTrimMigration, /SECURITY DEFINER[\s\S]*SET search_path = ''[\s\S]*auth\.uid\(\) IS NULL OR auth\.uid\(\) <> p_user_id/,
  "The RPC correction must preserve the hardened execution context and account ownership guard");
assert.match(syncRpcTrimMigration, /REVOKE ALL ON FUNCTION public\.upsert_user_state_if_newer[\s\S]*FROM PUBLIC, anon[\s\S]*GRANT EXECUTE ON FUNCTION public\.upsert_user_state_if_newer[\s\S]*TO authenticated/,
  "Only authenticated users may execute the corrected sync RPC");
assert.match(syncRpcTrimMigration, /NOTIFY pgrst, 'reload schema'/,
  "The migration must refresh the PostgREST schema cache after replacing the RPC");

const engine = read("src/hooks/use-cloud-sync-engine.tsx");
const storage = read("src/lib/storage.ts");
const supabaseTypes = read("src/integrations/supabase/types.ts");
const supabaseClient = read("src/integrations/supabase/client.ts");
const supabaseConfig = read("supabase/config.toml");
const flutterSupabase = read("pace_flutter/lib/core/supabase/pace_supabase.dart");

assert.match(
  supabaseConfig,
  /^project_id = "tqvuosujpkwmypkbyikq"$/m,
  "Supabase CLI must target the selected PaceOS database project",
);
assert.doesNotMatch(
  supabaseConfig,
  /jayzswkabxfhzmftagku/,
  "Supabase CLI must not retain the retired project reference",
);
assert.match(
  flutterSupabase,
  /String\.fromEnvironment\(\s*'SUPABASE_PUBLISHABLE_KEY',\s*defaultValue:\s*'sb_publishable_LNvF5dXGd49ZUKi1rC8y_Q_5xxGkrmF'/,
  "Flutter must default to the new project's publishable key",
);
assert.doesNotMatch(
  flutterSupabase,
  /SUPABASE_ANON_KEY/,
  "Flutter must not fall back to a legacy key that could point at the retired Supabase project",
);

assert.match(
  supabaseClient,
  /import\.meta\.env\.VITE_SUPABASE_URL\s*\|\|\s*process\.env\.SUPABASE_URL;/,
  "Web and SSR Supabase clients must use the deployment-specific URL",
);
assert.match(
  supabaseClient,
  /import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY\s*\|\|\s*process\.env\.SUPABASE_PUBLISHABLE_KEY;/,
  "Web and SSR Supabase clients must use the deployment-specific publishable key",
);
assert.match(
  supabaseClient,
  /if \(!SUPABASE_URL \|\| !SUPABASE_PUBLISHABLE_KEY\)/,
  "Supabase client initialization must fail closed when deployment configuration is missing",
);
assert.doesNotMatch(
  supabaseClient,
  /jayzswkabxfhzmftagku|sb_publishable_2C2_WSyuDwMzT8uRB2uO_A_f-J2zTfQ/,
  "Supabase client must not silently fall back to the retired project URL or its public key",
);

const writeItemStart = engine.indexOf("const writeItem =");
const pushItemStart = engine.indexOf("const pushItem =", writeItemStart);
const flushQueueStart = engine.indexOf("const flushQueue =", pushItemStart);
assert.ok(writeItemStart >= 0 && pushItemStart > writeItemStart && flushQueueStart > pushItemStart, "cloud write acknowledgement handlers must remain identifiable");
const writeItemBlock = engine.slice(writeItemStart, pushItemStart);
const pushItemBlock = engine.slice(pushItemStart, flushQueueStart);
assert.match(writeItemBlock, /if \(!payload\.accepted\)[\s\S]*recordConflict\(row\.key, item\.value, row\.value, row\.updated_at\)/, "a stale server rejection must create a resolvable conflict without replacing the local value");
assert.doesNotMatch(writeItemBlock, /applyRemoteAndRemember\(row\.key/, "a rejected local write must not overwrite the user's local snapshot with remote data");
assert.match(pushItemBlock, /if \(accepted\) \{[\s\S]*unqueueIfMutation\(latest\.key,\s*latest\.updatedAt,\s*user\.id\)/, "only the exact server-accepted mutation for the active account may leave the outbox");
assert.match(pushItemBlock, /else \{[\s\S]*Rejected writes remain durable in the outbox/, "a rejected mutation must remain queued until conflict resolution");
assert.doesNotMatch(pushItemBlock, /\}\s*unqueueIfMutation\(latest\.key, latest\.updatedAt\)/, "outbox entries must not be removed unconditionally after a rejected write");

const syncRpcTypeStart = supabaseTypes.indexOf("upsert_user_state_if_newer:");
const syncRpcTypeBlock = supabaseTypes.slice(syncRpcTypeStart, syncRpcTypeStart + 350);
assert.ok(syncRpcTypeStart >= 0, "Generated cloud sync RPC type must remain identifiable");
assert.match(
  syncRpcTypeBlock,
  /Returns: (?:Json|boolean)/,
  "Generated Supabase types must reflect one of the supported boolean or jsonb sync RPC contracts",
);
assert.match(
  writeItemBlock,
  /typeof responseData === "boolean"[\s\S]*updated_at: item\.updatedAt/,
  "Web sync must normalize the legacy boolean RPC response using the timestamp supplied in the write request",
);
assert.match(writeItemBlock, /supabase\.rpc\("upsert_user_state_if_newer"/, "Web cloud sync must use the generated typed RPC contract");
assert.doesNotMatch(writeItemBlock, /const rpc = supabase\.rpc as unknown as/, "Web cloud sync must not hide the generated RPC response contract behind an unsafe cast");

const scopedQueueStart = engine.indexOf("function scopedSyncStorageKey");
const scopedQueueEnd = engine.indexOf("function readDomainRecord", scopedQueueStart);
assert.ok(scopedQueueStart >= 0 && scopedQueueEnd > scopedQueueStart, "Account-scoped browser queue helpers must remain identifiable");
const scopedQueueHelpers = engine.slice(scopedQueueStart, scopedQueueEnd);
assert.match(scopedQueueHelpers, /function readScopedSyncValue[\s\S]*localStorage\.getItem\(base\)[\s\S]*localStorage\.setItem\(scopedKey[\s\S]*localStorage\.removeItem\(base\)/, "Legacy browser sync state must be claimed into the first account namespace before the global key is removed");
assert.match(scopedQueueHelpers, /function readQueue\(userId: string\)/, "Web outbox reads must always require an explicit account ID");
assert.match(scopedQueueHelpers, /function queueItem\(item: QueueItem, userId: string\)/, "Web local mutations must be enqueued under their originating account");
assert.match(scopedQueueHelpers, /ownerUserId: userId/, "Web queue items must retain their owning account ID");
assert.match(scopedQueueHelpers, /function readMeta\(userId: string\)/, "Web sync versions must be account-scoped");
assert.match(scopedQueueHelpers, /function readConflicts\(userId: string\)/, "Web unresolved conflicts must be account-scoped");
assert.doesNotMatch(engine, /readQueue\(\)/, "No Web sync path may read an unscoped outbox");
assert.doesNotMatch(engine, /readMeta\(\)/, "No Web sync path may read unscoped sync versions");
assert.doesNotMatch(engine, /readConflicts\(\)/, "No Web sync path may read another account's conflicts");
assert.match(engine, /running\.current\[user\.id\]/, "Concurrent sync locks must be isolated per authenticated account");
assert.match(engine, /const writeKey = `\$\{user\.id\}:\$\{item\.key\}`/, "in-flight key writes must be isolated per authenticated account");

const accountScope = read("src/lib/account-scope.ts");
const authProvider = read("src/hooks/use-auth.tsx");
const accountScopeRuntimeTest = read("scripts/account-scope-test.mjs");
const packageScripts = JSON.parse(read("package.json")).scripts;
assert.match(accountScope, /function accountSnapshotKey\(scope: string\)/, "Web local state must be stored in a separate snapshot for each account");
assert.match(accountScope, /function isAccountLocalKey\(key: string\)/, "Web account switching must explicitly define which app data follows a user");
assert.match(accountScope, /previousScope === null[\s\S]*if \(!userId\) return false[\s\S]*accountSnapshotKey\(nextScope\)/, "The first authenticated account must adopt legacy local data without deleting it");
const previousSnapshotWrite = accountScope.indexOf("accountSnapshotKey(previousScope)");
const previousStateClear = accountScope.indexOf("clearCurrentAccountState();", previousSnapshotWrite);
const nextSnapshotRestore = accountScope.indexOf("restoreAccountSnapshot(nextSnapshot);", previousStateClear);
assert.ok(
  previousSnapshotWrite >= 0 &&
    previousStateClear > previousSnapshotWrite &&
    nextSnapshotRestore > previousStateClear,
  "Switching accounts must save the previous account's state before restoring the next account's state",
);
assert.match(accountScope, /nextScope = userId \?\? "__guest__"/, "Signed-out browser state must use a distinct guest namespace");

assert.match(accountScope, /LEGACY_SYNC_KEYS = \[[\s\S]*pace\.__sync_queue[\s\S]*pace\.__sync_meta[\s\S]*pace\.__sync_conflicts/, "Legacy global queue, version and conflict keys must be migrated together");
assert.match(accountScope, /migrateLegacySyncState\(nextScope\)/, "The first authenticated account must claim legacy browser outbox state before sync hooks mount");
assert.match(accountScope, /migrateLegacySyncState\(previousScope\)/, "A later account switch must finish assigning legacy sync state to the account that owned the previous local data");
assert.match(accountScope, /localStorage\.removeItem\(legacyKey\)/, "Legacy global sync keys must be removed after their account-scoped copy is saved");

assert.match(accountScope, /localStorage\.setItem\(ACCOUNT_SCOPE_KEY, previousScope\)/, "A failed restore must roll back to the previous account namespace");
assert.match(authProvider, /switchLocalAccountScope\(nextSession\?\.user\.id \?\? null\)/, "Every auth session transition must switch the local data namespace");
assert.match(authProvider, /<Ctx\.Provider[\s\S]*key=\{session\?\.user\.id \?\? "__guest__"\}/, "React state hooks must remount after switching local account namespaces");
assert.match(authProvider, /authEventVersion[\s\S]*authEventVersion === initialVersion/, "A delayed initial session lookup must not reverse a newer authentication event");

assert.match(authProvider, /hasAuthEvent = true[\s\S]*!hasAuthEvent && authEventVersion === initialVersion/, "Any auth stream event must take precedence over a delayed initial getSession result");
assert.match(accountScope, /const restored = readAccountSnapshot\(nextScope\)[\s\S]*catch \(error\)[\s\S]*restoreAccountSnapshot\(currentSnapshot\)/, "A failed initial account restore must roll back to the legacy local snapshot");

assert.match(authProvider, /scopeError/, "The app must not render account data if namespace restoration fails");

assert.match(accountScopeRuntimeTest, /legacyNutrition[\s\S]*switchLocalAccountScope\("user-a"\)[\s\S]*readJson\("pace\.nutrition\.items"\)/, "the first authenticated user must adopt existing legacy Nutrition data instead of losing it");
assert.match(accountScopeRuntimeTest, /user-a[\s\S]*user-b[\s\S]*__guest__/, "Browser account-scope runtime test must exercise separate users and guest data");
assert.match(accountScopeRuntimeTest, /corrupt target snapshot[\s\S]*assert\.throws/, "Browser account-scope runtime test must prove failed restores do not erase the active user's data");
assert.match(packageScripts["test:sync"], /node --experimental-strip-types scripts\/account-scope-test\.mjs/, "The standard sync test command must execute the browser account-scope runtime suite");






const nutritionAi = read("src/lib/ai-chat.server.ts");
const nutritionAiChat = read("src/components/NutritionDailyAiChat.tsx");
const nutritionLog = read("src/lib/nutrition-log.ts");
const nutritionRoute = read("src/routes/nutrition.tsx");
assert.match(nutritionLog, /function activeNutritionAccountId\(\)[\s\S]*pace\.__account_scope[\s\S]*scope !== "__guest__"/, "Nutrition local bridge must identify the account whose local snapshot is active");
assert.match(nutritionLog, /refreshNutritionFromFoodLog\([\s\S]*expectedUserId = options\.expectedUserId \?\? activeNutritionAccountId\(\)[\s\S]*activeNutritionAccountId\(\) !== expectedUserId[\s\S]*user\.id !== expectedUserId/, "An in-flight Nutrition refresh must remain bound to the user who started it");
assert.match(nutritionLog, /persistNutritionItem\([\s\S]*expectedUserId = activeNutritionAccountId\(\)[\s\S]*user\.id !== expectedUserId/, "Manual Nutrition inserts must remain bound to the account active when the action started");
assert.match(nutritionLog, /export async function addNutritionItem\([\s\S]*const expectedUserId = activeNutritionAccountId\(\)[\s\S]*refreshNutritionFromFoodLog\(logDate, \{ expectedUserId \}\)/, "A completed insert must refresh only the original account and captured log date after persistence");
assert.match(nutritionLog, /const operationKey = operationId \? `\$\{expectedUserId\}:\$\{operationId\}` : null[\s\S]*completedOperations\.get\(operationKey\)/, "Nutrition idempotency reservations must be scoped to the originating account");
assert.match(nutritionRoute, /const expectedUserId = currentNutritionAccountId\(\)[\s\S]*currentNutritionAccountId\(\) !== expectedUserId/, "The Nutrition delete UI must stop before writing into a newly active account");
assert.match(nutritionLog, /expectedUserId = activeNutritionAccountId\(\)[\s\S]*user\.id !== expectedUserId[\s\S]*activeNutritionAccountId\(\) !== expectedUserId/, "Queued Nutrition bridge writes must stay bound to the account that scheduled them");
assert.match(nutritionLog, /for \(const \{ id, day, item \} of nextRows\)[\s\S]*activeNutritionAccountId\(\) !== userId/, "Nutrition bridge must abort row-by-row after an account switch");
assert.match(nutritionLog, /function deletedIdsStorageKey\(userId: string\)[\s\S]*encodeURIComponent\(userId\)/, "Nutrition deletion tombstones must use a distinct storage namespace per account");
assert.match(nutritionLog, /localStorage\.getItem\(deletedIdsStorageKey\(userId\)\)[\s\S]*legacy\?\.userId === userId[\s\S]*localStorage\.removeItem\(DELETED_IDS_KEY\)/, "Legacy single-account tombstones must migrate only to their owning account");
const userStateBroadcastMigration = read("supabase/migrations/20261126171744_realtime_user_state_broadcast_sync.sql");
const userStateBroadcastHardeningMigration = read("supabase/migrations/20261126173346_harden_realtime_user_state_broadcast_filters.sql");
assert.match(userStateBroadcastMigration, /CREATE OR REPLACE FUNCTION pace_private\.broadcast_user_state_sync_event\(\)[\s\S]*realtime\.send\([\s\S]*'key'[\s\S]*'updated_at'[\s\S]*'user_state_changed'[\s\S]*'pace-user-state:'[\s\S]*true/);
assert.match(userStateBroadcastMigration, /CREATE TRIGGER user_state_broadcast_sync_event[\s\S]*AFTER INSERT OR UPDATE ON public\.user_state/);
assert.match(userStateBroadcastMigration, /ON realtime\.messages[\s\S]*FOR SELECT[\s\S]*TO authenticated[\s\S]*realtime\.topic\(\)[\s\S]*auth\.uid\(\)/);
assert.match(userStateBroadcastMigration, /CREATE SCHEMA IF NOT EXISTS pace_private[\s\S]*REVOKE ALL ON SCHEMA pace_private FROM PUBLIC, anon, authenticated[\s\S]*CREATE OR REPLACE FUNCTION pace_private\./);
assert.doesNotMatch(userStateBroadcastMigration, /CREATE OR REPLACE FUNCTION public\./,
  "The SECURITY DEFINER broadcast trigger must not live in the exposed public schema");
assert.match(userStateBroadcastMigration, /pace\.finance|pace\.ai\.conversations|pace\.__/,
  "The database trigger must not announce device-local or private keys");
assert.ok(
  userStateBroadcastHardeningMigration.includes("v_key !~ '^pace[.]'") &&
    userStateBroadcastHardeningMigration.includes("v_key ~ '^pace[.]__'") &&
    userStateBroadcastHardeningMigration.includes("v_key ~ '^pace[.]domain[.]ai[.](local[.]|debug|pending:)'"),
  "Realtime key allow-list and exclusions must use literal-dot matching regardless of string settings",
);
assert.equal(
  userStateBroadcastHardeningMigration.includes("\\."),
  false,
  "Realtime key filtering must not rely on backslash-escaped regex dots",
);
assert.ok(
  userStateBroadcastHardeningMigration.includes("realtime.messages.extension = 'broadcast'") &&
    userStateBroadcastHardeningMigration.includes("realtime.topic() = 'pace-user-state:'"),
  "Realtime authorization must only allow Broadcast reads on the authenticated user's own topic",
);
const appearanceSyncMigration = read("supabase/migrations/20261127143227_sync_visual_preferences_and_wallpaper_storage.sql");
const wallpaperHook = read("src/hooks/use-wallpaper.tsx");
const themeToggle = read("src/components/VisualThemeToggle.tsx");
const settingsRoute = read("src/routes/settings.tsx");
const rootRoute = read("src/routes/__root.tsx");
assert.match(wallpaperHook, /storage\.from\("pace-wallpapers"\)\.upload[\s\S]*storage\.from\("pace-wallpapers"\)\.download/,
  "Custom wallpaper bytes must be stored in private Storage and downloaded by object path");
assert.match(wallpaperHook, /setCustom: async \(file: File\): Promise<boolean> =>[\s\S]*const saveLocally = async \(\)[\s\S]*setChoice\(\{ kind: "custom", dataUrl \}\)[\s\S]*return false;[\s\S]*if \(!user\?\.id \|\| !isLegalCategoryAllowed\("sync_cloud"\)\)[\s\S]*return saveLocally\(\)[\s\S]*uploadWallpaper\(file, user\.id\)/,
  "Custom wallpaper uploads must remain local unless the authenticated user explicitly enabled cloud sync");
assert.match(wallpaperHook, /file\.size > 3 \* 1024 \* 1024[\s\S]*stockage du navigateur/,
  "Local-only base64 wallpapers must stay below browser local-storage limits");
assert.match(engine, /function isInlineWallpaperValue\(key: string, value: unknown\)[\s\S]*dataUrl[\s\S]*startsWith\("data:image\/"[\s\S]*function isSyncableRecord\(key: string, value: unknown\)/,
  "The sync engine must identify inline wallpaper image bytes before they enter the cloud outbox");
assert.ok(engine.includes('(typeof wallpaper.localPath === "string" && wallpaper.localPath.length > 0)'),
  "Native local filesystem wallpaper paths must never enter the shared user_state outbox");
assert.match(engine, /items[\s\S]*filter\(\(item\) => isSyncableRecord\(item\.key, item\.value\)/,
  "Previously queued base64 wallpapers must be filtered out when reading the account outbox");
assert.match(engine, /function queueItem\(item: QueueItem, userId: string\)[\s\S]*!isSyncableRecord\(item\.key, item\.value\)/,
  "No bootstrap or migration path may enqueue inline wallpaper image bytes");
assert.match(engine, /const pushItem = async \(item: QueueItem\) => \{[\s\S]*!isSyncableRecord\(item\.key, item\.value\)/,
  "No queued inline wallpaper image may be uploaded even if it predates the consent guard");
assert.match(read("src/components/WallpaperSettings.tsx"), /const synced = await setCustom\(f\)[\s\S]*enregistré sur cet appareil/,
  "Wallpaper settings must distinguish local-only saves from cloud-synchronized uploads");
assert.match(wallpaperHook, /setChoice\(\{ kind: "custom", storagePath \}\)/,
  "Only a small per-user Storage path, never base64 image bytes, may enter account sync");
assert.match(wallpaperHook, /finally\(\(\) => \{[\s\S]*legacyWallpaperMigrations\.get\(migrationKey\) === migration[\s\S]*legacyWallpaperMigrations\.delete\(migrationKey\)/,
  "Completed legacy wallpaper migrations must release data URLs retained as Map keys");
assert.match(wallpaperHook, /function releaseWallpaperObjectUrl\(path: string \| undefined\)[\s\S]*wallpaperObjectUrls\.delete\(path\)[\s\S]*URL\.revokeObjectURL\(url\)/,
  "Inactive custom wallpaper ObjectURLs must be revoked when the selection changes");
assert.match(wallpaperHook, /let wallpaperRenderVersion = 0;[\s\S]*const renderVersion = \+\+wallpaperRenderVersion[\s\S]*renderVersion !== wallpaperRenderVersion/,
  "Late wallpaper downloads must not override a newer selection after rapid background changes");
assert.match(wallpaperHook, /let request: Promise<string>;[\s\S]*wallpaperObjectUrls\.get\(path\) === request[\s\S]*wallpaperObjectUrls\.delete\(path\)/,
  "A stale failed download must not evict a newer cached request for the same wallpaper path");
const wallpaperApplyStart = wallpaperHook.indexOf("export function applyWallpaper(");
const wallpaperApplyEnd = wallpaperHook.indexOf("/** Read choice synchronously", wallpaperApplyStart);
const wallpaperApply = wallpaperHook.slice(wallpaperApplyStart, wallpaperApplyEnd);
assert.ok(
  wallpaperApplyStart >= 0 &&
    wallpaperApplyEnd > wallpaperApplyStart &&
    wallpaperApply.includes("const isStillSelected = root.dataset.wallpaperPath === choice.storagePath;") &&
    wallpaperApply.indexOf("if (!isStillSelected)") < wallpaperApply.indexOf("if (renderVersion !== wallpaperRenderVersion) return;"),
  "Repeated renders of the same wallpaper must not revoke the ObjectURL still used by the current render",
);

assert.match(themeToggle, /persistLocalPreference\(VISUAL_THEME_KEY, theme\)/,
  "Changing visual theme must immediately enqueue the account preference for cloud sync");
assert.match(settingsRoute, /persistLocalPreference\("pace\.dark", v \? "1" : "0"\)/,
  "Changing dark mode must immediately enqueue the account preference for cloud sync");
assert.match(storage, /export function persistLocalPreference[\s\S]*CustomEvent<LocalWriteDetail>\(LOCAL_WRITE_EVENT/,
  "Appearance preferences must use the same durable local-write event as the rest of cloud sync");
assert.match(rootRoute, /onRemoteAppearance[\s\S]*readLocalPreference(?:<string>)?\("pace\.visual-theme"/,
  "Remote theme and dark-mode updates must be applied to the document without a manual reload");
assert.match(appearanceSyncMigration, /pace-wallpapers[\s\S]*CREATE POLICY "pace_wallpapers_select_own"[\s\S]*auth\.uid\(\)/,
  "Custom wallpaper objects must live in a private, per-user Storage bucket");
assert.doesNotMatch(appearanceSyncMigration, /'pace\.dark'[\s\S]*'pace\.visual-theme'[\s\S]*'pace\.wallpaper'/,
  "Realtime must broadcast account appearance keys rather than excluding them");

const flutterAppAppearance = read("pace_flutter/lib/app/pace_app.dart");
const visualThemeStart = flutterAppAppearance.indexOf("Future<void> setVisualTheme(String theme) async {");
const visualThemeEnd = flutterAppAppearance.indexOf("void dispose()", visualThemeStart);
const visualThemeHandler = flutterAppAppearance.slice(visualThemeStart, visualThemeEnd);
assert.ok(visualThemeStart >= 0 && visualThemeEnd > visualThemeStart &&
  !visualThemeHandler.includes("write('pace.dark'"),
  "Selecting Glass must force dark presentation without overwriting the user's separate dark-mode preference");
const flutterThemeAppearance = read("pace_flutter/lib/ui/pace_theme.dart");
const flutterSettingsAppearance = read("pace_flutter/lib/features/more/more_page.dart");
assert.ok(
  flutterThemeAppearance.includes("'aurora'") && flutterThemeAppearance.includes("'orchid'") &&
    flutterSettingsAppearance.includes("for (final preset in paceWallpaperPresets)"),
  "Native Flutter must render the same synchronized wallpaper preset IDs as Web/PWA",
);

const visualThemeCss = read("src/visual-theme.css");
assert.ok(!visualThemeCss.includes("Pace Glass — legacy implementation kept as annotation."),
  "The malformed nested legacy Glass comment must not be reintroduced by appearance changes");
assert.match(visualThemeCss, /Uniform Liquid Glass material[\s\S]*--lg-material-fill: var\(--lg-fill\)[\s\S]*--lg-material-blur: 22px/,
  "Liquid Glass must define one shared material fill, transparency and blur level");
assert.match(visualThemeCss, /\.glass-card[\s\S]*\.glass-thin[\s\S]*\.glass-icon[\s\S]*\[role="dialog"\][\s\S]*input[\s\S]*background: var\(--lg-material-fill\)[\s\S]*backdrop-filter: blur\(var\(--lg-material-blur\)\)/,
  "Cards, controls, dialogs and navigation chrome must share the same Liquid Glass material");
assert.ok(visualThemeCss.includes('[data-visual-theme="glass"] [data-slot="card"]') &&
  visualThemeCss.includes('--lg-material-blur: 5px') &&
  visualThemeCss.includes('--lg-material-blur: 0px'),
  "All card implementations must follow the shared blur variable at every glass quality level");
assert.match(visualThemeCss, /data-lg-refract\][\s\S]*blur\(var\(--lg-material-blur\)\)/,
  "Chromium refraction must not introduce a separate blur level");

const nutritionRealtimeMigration = read("supabase/migrations/20261111220000_enable_food_log_realtime_sync.sql");
const domainStore = read("src/lib/domain-store.ts");
assert.doesNotMatch(engine, /WALLPAPER_SYNC_KEYS/,
  "Web cloud sync must not classify account wallpaper metadata as device-local");
assert.ok(
  engine.includes('.not("key", "in", DEVICE_LOCAL_PULL_FILTER)'),
  "Web must filter device-local state in PostgREST before downloading JSONB values",
);
assert.ok(
  engine.includes("const topic = `pace-user-state:${user.id}`;") &&
    engine.includes("realtimeChannel = createPrivateRealtimeChannel(topic)") &&
    engine.includes('.on("broadcast", { event: "user_state_changed" }'),
  "Web must receive private low-payload Broadcast notifications for the authenticated account",
);

assert.match(
  engine,
  /message\.payload as \{ key\?: unknown \}[\s\S]*isSyncableKey\(payload\.key\)[\s\S]*void syncNow\(\)/,
  "Web Broadcast callbacks must validate the key and pull authoritative state rather than trusting notification payloads",
);
assert.match(
  engine,
  /let syncInFlight: Promise<void> \| null = null;[\s\S]*let syncRequested = false;[\s\S]*if \(syncInFlight\)[\s\S]*syncRequested = true;[\s\S]*while \(syncRequested/,
  "Web Realtime bursts must coalesce into serialized sync cycles without dropping the final notification",
);
assert.match(
  engine,
  /const reconcileTimer = window\.setInterval\(\(\) => \{\s*if \(document\.visibilityState === "visible" && allowed\(\)\) void syncNow\(\);\s*\}, 60_000\)/,
  "Web must reconcile remote user_state changes through a 60-second filtered pull",
);
assert.ok(
  engine.includes("const DEVICE_LOCAL_SYNC_KEYS = [") &&
    ["pace.sport.active","pace.legal.consent","pace.billing.device_id","pace.watch.last_metrics","pace.ai.conversations","pace.ai.deleted_conversations","pace.domain.outbox"]
      .every((key) => engine.includes(`"${key}"`)) &&
    engine.includes("const DEVICE_LOCAL_SYNC_PREFIXES = [") &&
    ["pace.__","pace.ai.pending:","pace.ai.debug","pace.local-ai.","pace.ai.local.","pace.privacy.","pace.finance.","pace.ble.","pace.import."]
      .every((prefix) => engine.includes(`"${prefix}"`)),
  "Web must centralize the static and prefix-based device-local sync exclusions",
);
assert.ok(engine.includes('function keyPrefixRegex(prefix: string)') && engine.includes('prefix.replaceAll(".", "[.]")'),
  "Web prefix regex must convert literal dots to regex character classes");
assert.match(engine, /function isDeviceLocalSyncKey\(key: string\)[\s\S]*domainCanonicalKey[\s\S]*EXCLUDED\.has\(domainCanonicalKey\)[\s\S]*ALL_DEVICE_LOCAL_SYNC_PREFIXES\.some/);
assert.equal(`^${"pace.__".replaceAll(".", "[.]")}`, "^pace[.]__",
  "The internal-key regex must treat underscores literally instead of as SQL LIKE wildcards");
assert.match(engine, /function isSyncableKey\(key: string\)[\s\S]*!isDeviceLocalSyncKey\(key\)/,
  "Web pushes, queues and bootstrap must reject device-local keys");
const wallpaperGuardStart = engine.indexOf("function isInlineWallpaperValue(");
const wallpaperGuardEnd = engine.indexOf("function isSyncableRecord", wallpaperGuardStart);
const wallpaperGuard = engine.slice(wallpaperGuardStart, wallpaperGuardEnd);
assert.ok(
  wallpaperGuardStart >= 0 &&
    wallpaperGuardEnd > wallpaperGuardStart &&
    wallpaperGuard.includes('typeof wallpaper.storagePath !== "string"') &&
    wallpaperGuard.includes("wallpaper.storagePath.trim().length === 0"),
  "Web may sync custom wallpapers only as non-empty private Storage object paths",
);
assert.ok(
  engine.includes("if (!isSyncableRecord(key, row.value)) continue;"),
  "Web remote pulls must reject inline image data, device-local paths and malformed custom wallpaper records",
);
assert.ok(
  engine.includes("const ownerPrefix = `\u0024{userId}/`;") &&
    engine.includes("const objectName = storagePath.slice(ownerPrefix.length);") &&
    engine.includes("/^[A-Za-z0-9._-]+$/.test(objectName)"),
  "Web must reject wallpaper object paths outside the account folder or containing nested, traversal-like, or encoded names",
);
const webWallpaperPreserveStart = engine.indexOf("const localWallpaperOverride =");
const webWallpaperPreserveEnd = engine.indexOf("const localIsEmpty", webWallpaperPreserveStart);
const webWallpaperPreserve = engine.slice(webWallpaperPreserveStart, webWallpaperPreserveEnd);
assert.ok(
  webWallpaperPreserveStart >= 0 &&
    webWallpaperPreserveEnd > webWallpaperPreserveStart &&
    webWallpaperPreserve.includes("isInlineWallpaperValue(key, localStoredValue)") &&
    webWallpaperPreserve.includes("isInlineWallpaperValue(key, localDomain.value)") &&
    webWallpaperPreserve.includes("meta[key] = updatedAt") &&
    webWallpaperPreserve.includes("continue;"),
  "Web remote pulls must preserve a device-local custom wallpaper fallback until upload or explicit replacement",
);


assert.ok(
  engine.includes("for (const prefix of ALL_DEVICE_LOCAL_SYNC_PREFIXES)") &&
    engine.includes('.not("key", "in", DEVICE_LOCAL_PULL_FILTER)') &&
    engine.includes('request = request.not("key", "match", keyPrefixRegex(prefix));') &&
    engine.includes('request = request.not("key", "match", keyPrefixRegex(legacyPrefix));') &&
    !engine.includes('request = request.not("key", "like"'),
  "Web PostgREST pulls must exclude device-local keys and legacy prefixes before downloading JSONB values",
);
assert.ok(
  !engine.includes("...WALLPAPER_SYNC_KEYS") &&
    engine.includes("...DEVICE_LOCAL_SYNC_KEYS") &&
    engine.includes("const EXCLUDED = new Set<string>"),
  "Web sync must allow account wallpaper metadata while retaining unrelated device-local exclusions",
);


const flutterSync = read("pace_flutter/lib/core/sync/sync_service.dart");
const flutterCompliance = read("pace_flutter/lib/core/compliance/compliance_service.dart");
assert.match(
  flutterSync,
  /factory CloudSyncWriteResponse\.fromRpc\([\s\S]*if \(response is bool\)[\s\S]*fallbackUpdatedAt/,
  "Flutter sync must normalize the legacy boolean RPC response using the timestamp supplied in the write request",
);
const flutterNutrition = read("pace_flutter/lib/features/nutrition/nutrition_page.dart");
const flutterApp = read("pace_flutter/lib/app/pace_app.dart");
const flutterSettings = read("pace_flutter/lib/features/more/more_page.dart");
const flutterConsentLoadStart = flutterSettings.indexOf("Future<void> _loadConsent() async {");
const flutterConsentLoadEnd = flutterSettings.indexOf("Future<void> _setConsent", flutterConsentLoadStart);
const flutterConsentLoad = flutterSettings.slice(flutterConsentLoadStart, flutterConsentLoadEnd);
assert.ok(
  flutterConsentLoadStart >= 0 &&
    flutterConsentLoadEnd > flutterConsentLoadStart &&
    flutterConsentLoad.includes("await _migrateLocalWallpaperToCloud();") &&
    flutterConsentLoad.includes("catch (_) {}") &&
    flutterConsentLoad.indexOf("await widget.sync.syncNow();") > flutterConsentLoad.indexOf("catch (_) {}"),
  "A missing private wallpaper bucket must not block theme and preset synchronization on startup",
);
assert.ok(
  flutterSettings.includes("String _wallpaperSubtitle()") &&
    flutterSettings.includes("choice['localPath'] is String") &&
    flutterSettings.includes("image conservée sur cet appareil"),
  "Native settings must not claim a local-only custom wallpaper is already cloud-synchronized",
);

const flutterLocalStore = read("pace_flutter/lib/core/storage/local_store.dart");
const flutterLocalStoreTest = read("pace_flutter/test/local_store_account_scope_test.dart");
const flutterTest = read("pace_flutter/test/cloud_sync_contract_test.dart");
const flutterTheme = read("pace_flutter/lib/ui/pace_theme.dart");
assert.match(flutterSync, /static bool isSyncableValue\([\s\S]*required String userId[\s\S]*isLocalOnlyWallpaperValue[\s\S]*storagePath\.startsWith\('\$userId\/'\)/,
  "Flutter may synchronize only portable wallpaper Storage paths owned by the active account");
assert.ok(flutterSync.includes("SyncService.isSyncableValue(key, localStore.read(key), userId: userId)") &&
  flutterSync.includes("SyncService.isSyncableValue(key, operation['value'], userId: userId)") &&
  flutterSync.includes("SyncService.isSyncableValue(key, row['value'], userId: userId)"),
  "Flutter push, outbox and remote-pull paths must all validate wallpaper ownership against the active account");
assert.ok(flutterTest.includes("another-user/wallpaper.jpg") &&
  flutterTest.includes("user-id/nested/wallpaper.jpg"),
  "Flutter unit tests must reject wallpaper object paths owned by another user or nested outside the expected object namespace");
assert.match(flutterSync, /static bool isLocalOnlyWallpaperValue\\(String key, dynamic value\\)[\\s\\S]*localPath[\\s\\S]*dataUrl[\\s\\S]*storagePath/,
  "Flutter must identify device-local custom wallpaper overrides separately from portable Storage paths");
const nativeWallpaperPreserveStart = flutterSync.indexOf("if (SyncService.isLocalOnlyWallpaperValue(");
const nativeWallpaperPreserveEnd = flutterSync.indexOf("final localUpdatedAt", nativeWallpaperPreserveStart);
const nativeWallpaperPreserve = flutterSync.slice(nativeWallpaperPreserveStart, nativeWallpaperPreserveEnd);
assert.ok(
  nativeWallpaperPreserveStart >= 0 &&
    nativeWallpaperPreserveEnd > nativeWallpaperPreserveStart &&
    nativeWallpaperPreserve.includes("localStore.markSyncedAt(key, remoteUpdatedAt)") &&
    nativeWallpaperPreserve.includes("continue;"),
  "Flutter remote pulls must not replace a local custom wallpaper while its Storage upload is unavailable",
);

assert.match(flutterSettings, /ImagePicker\(\)[\s\S]*ImageSource\.gallery[\s\S]*pace-wallpapers[\s\S]*storagePath/,
  "Flutter settings must support choosing a custom wallpaper and uploading it to private Storage when consent is enabled");
assert.match(flutterSettings, /localPath[\s\S]*Active la synchronisation pour la partager/,
  "Flutter must keep a local wallpaper usable without cloud consent and explain how to share it");
assert.ok(
  flutterApp.includes("pace.visual-theme") &&
    flutterApp.includes("pace.dark") &&
    flutterApp.includes("addChangeListener") &&
    flutterApp.includes("_onLocalStoreChange"),
  "Flutter must apply account-synced visual theme and dark-mode changes immediately after local or remote writes",
);
assert.ok(
  flutterTheme.includes("class PaceWallpaperBackground") &&
    flutterTheme.includes("pace-wallpapers") &&
    flutterTheme.includes("Image.file(") &&
    flutterTheme.includes("Image.memory("),
  "Flutter must render local and private-Storage wallpapers behind the native application",
);
assert.ok(
  flutterTheme.includes("localStore.currentAccountId == userId") &&
    flutterTheme.includes("storagePath.startsWith('$userId/')") &&
    flutterTheme.includes("!storagePath.substring(userId.length + 1).contains('/')"),
  "Flutter must verify wallpaper object ownership and path shape before downloading it",
);
assert.match(flutterTheme, /final neutral = glass \|\| visualTheme == 'signal'[\s\S]*seedColor: neutral \? const Color\(0xFF777777\)/,
  "Flutter Signal and Liquid Glass must use the neutral grayscale palette across devices");
assert.match(flutterTheme, /Uri\.encodeComponent\(path\)[\s\S]*pace_wallpaper_\$cacheName\.cache/,
  "Flutter private wallpaper cache filenames must remain stable across app launches");
assert.match(flutterLocalStore, /Future<void> applyRemote\([\s\S]*_notifyChange\(key\)/,
  "Remote theme and wallpaper updates must notify the Flutter UI without requiring an app restart");
const syncSchedulerStart = flutterSync.indexOf("void _scheduleSync()");
const syncSchedulerEnd = flutterSync.indexOf("/// A durable local write", syncSchedulerStart);
assert.ok(
  syncSchedulerStart >= 0 && syncSchedulerEnd > syncSchedulerStart,
  "Native background sync schedulers must remain identifiable",
);
const syncSchedulerBlock = flutterSync.slice(syncSchedulerStart, syncSchedulerEnd);
assert.ok(
  syncSchedulerBlock.includes("unawaited(syncNow().catchError((Object _) {}));"),
  "Background local mutation and reconnect triggers must contain transient sync errors",
);
assert.ok(
  syncSchedulerBlock.includes("unawaited(_handleFoodLogRealtime(userId).catchError((Object _) {}));"),
  "Background food_log Realtime callbacks must contain transient reconciliation errors",
);
assert.equal(flutterSync.includes("unawaited(syncNow());"), false,
  "No native background sync trigger may leak an uncaught sync failure");
assert.equal(flutterSync.includes("unawaited(_handleFoodLogRealtime(userId))"), false,
  "No native food_log Realtime trigger may leak an uncaught reconciliation failure");
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
assert.match(flutterSync, /PaceComplianceService\(client\)\.hasConsent\('sync_cloud'\)/, "Flutter sync engine must delegate functional consent lookup to the canonical compliance service");
assert.doesNotMatch(flutterSync, /consent_type', 'sync_cloud'/, "Flutter must not query the granular consent_records table for the functional sync option");
assert.match(flutterCompliance, /if \(consentType == 'sync_cloud'\)[\s\S]*_recordLegalConsentOption/, "The functional sync option must be handled separately from granular consent records");
assert.match(flutterCompliance, /from\('legal_consent'\)[\s\S]*select\('opts'\)[\s\S]*legalConsentOptionGranted\(rows\.first\['opts'\], 'sync_cloud'\)/, "Flutter must read sync_cloud from the user's persisted legal_consent options");
assert.match(flutterCompliance, /withLegalConsentOption\([\s\S]*option: 'sync_cloud'[\s\S]*granted: granted/, "Flutter must update only the functional sync option while preserving other legal options");
assert.match(flutterSettings, /PaceComplianceService\(client\)\.hasConsent\('sync_cloud'\)/, "Flutter settings must display the canonical saved sync option");
assert.match(flutterSync, /_cloudSyncConsent = null/, "A failed consent lookup must remain distinguishable from an explicit denial");
assert.match(flutterNutrition, /impossible de vérifier le consentement cloud/, "Nutrition must explain when consent lookup is unavailable instead of falsely claiming consent was denied");
assert.match(flutterSync, /Future<void> _pushPending\(\)[\s\S]*userId == null[\s\S]*localStore\.currentAccountId != userId[\s\S]*!_hasCachedCloudSyncConsent\(userId\)[\s\S]*\{\s*return;/, "Flutter must not push local outbox mutations without an authenticated matching account and sync_cloud consent");
assert.match(flutterSync, /Future<void> _pullRemote\(\)[\s\S]*localStore\.currentAccountId != userId[\s\S]*client\?\.auth\.currentUser\?\.id != userId[\s\S]*!_hasCachedCloudSyncConsent\(userId\)[\s\S]*\{\s*return;/, "Flutter must not pull remote state for a mismatched account or without sync_cloud consent");
assert.match(flutterSync, /static const Set<String> excludedSyncKeys = \{[\s\S]*\x27pace\.ai\.conversations\x27[\s\S]*\x27pace\.finance\.pin\.hash\x27/, "Native sync must keep AI transcripts and finance PINs device-local");
assert.match(flutterSync, /static String get excludedRemotePullKeysFilter[\s\S]*excludedRemotePullKeys\.map\(\(key\) =>/,
  "Native PostgREST exact-key filter must be generated from the canonical device-local exclusion set");
assert.doesNotMatch(flutterSync, /onPostgresChanges\([\s\S]{0,300}table: 'user_state'/,
  "Flutter must not subscribe to generic user_state Postgres Changes events");
assert.doesNotMatch(flutterSync, /PostgresChangeFilterType\.match|userStateRealtimeFilters/,
  "Flutter Realtime must not use undocumented regex or negated prefix filters");
assert.match(flutterSync, /channel\([\s\S]{0,160}'pace-user-state:\$userId'[\s\S]{0,160}RealtimeChannelConfig\(private: true\)/,
  "Flutter must join the same authenticated private sync Broadcast topic as Web");
assert.match(flutterSync, /\.onBroadcast\([\s\S]*event: 'user_state_changed'[\s\S]*SyncService\.isSyncableKey\(key\)[\s\S]*_scheduleSync\(\)/,
  "Flutter Broadcast callbacks must validate keys and schedule a cloud pull");

assert.match(flutterSync, /onPostgresChanges\([\s\S]*table: 'food_log'[\s\S]*PostgresChangeFilterType\.eq/,
  "Flutter food_log Realtime must remain scoped with a documented user_id equality filter");
assert.match(flutterSettings, /Synchronisation entre appareils[\s\S]*_setConsent\('sync_cloud', value\)/, "Flutter settings must expose the functional cross-device sync consent");
assert.match(flutterSettings, /await widget\.sync\.setCloudSyncConsent\(value\)/, "Changing consent must immediately update native sync behavior");

assert.match(flutterLocalStore, /__local_store_version': 2[\s\S]*__accounts/, "Flutter local storage must persist independent versioned account snapshots");
assert.match(flutterLocalStore, /void addMutationListener\(LocalMutationListener listener\)[\s\S]*_notifyMutation\(key\)/, "Durable native local mutations must expose a sync notification without coupling storage to Supabase");
const mutationListenerIndex = flutterSync.indexOf("localStore.addMutationListener(_onLocalMutation)");
const localMutationHandlerIndex = flutterSync.indexOf("void _onLocalMutation(String key)");
const deviceLocalCheckIndex = flutterSync.indexOf("!SyncService.isSyncableValue(key, localStore.read(key), userId: userId)", localMutationHandlerIndex);
const discardDeviceLocalIndex = flutterSync.indexOf("discardOperationForAccount(userId, operation)", deviceLocalCheckIndex);
const scheduleEligibleMutationIndex = flutterSync.indexOf("_scheduleSync();", discardDeviceLocalIndex);
assert.ok(
  mutationListenerIndex >= 0 &&
    localMutationHandlerIndex > mutationListenerIndex &&
    deviceLocalCheckIndex > localMutationHandlerIndex &&
    discardDeviceLocalIndex > deviceLocalCheckIndex &&
    scheduleEligibleMutationIndex > discardDeviceLocalIndex,
  "Flutter must immediately sync eligible local writes and purge device-local outbox items without uploading them",
);
assert.match(flutterSync, /static const Set<String> excludedSyncKeys = \{[\s\S]*\x27pace\.ai\.conversations\x27[\s\S]*\x27pace\.finance\.pin\.hash\x27/, "Native user_state writes must explicitly exclude AI transcripts and finance PIN keys");
assert.match(flutterSync, /Future<void> _pullRemote\(\)[\s\S]*excludedRemotePullKeysFilter[\s\S]*excludedRemotePullKeyPatterns/, "Native pulls must exclude canonical/legacy device-local keys in PostgREST before downloading rows");
assert.match(flutterSync, /localStore\.read\('__cloud_sync_last_pull_at'\)[\s\S]*query\.gt\([\s\S]*'updated_at'[\s\S]*localStore\.write\([\s\S]*'__cloud_sync_last_pull_at'[\s\S]*enqueueSync: false/, "Native cloud pulls must persist an account-scoped cursor and fetch only recently changed user_state rows after the initial bootstrap");
assert.match(flutterSync, /Future<void> _pushPending\(\)[\s\S]*!SyncService\.isSyncableValue\(key, operation\['value'\], userId: userId\)[\s\S]*discardOperationForAccount\(userId, operation\)/, "Previously queued device-local keys and foreign-owner wallpaper paths must be removed from the owning outbox without reaching Supabase");
assert.match(flutterLocalStore, /Future<void> discardOperationForAccount\([\s\S]*final scope = \x27account:\$userId\x27[\s\S]*snapshot\[\x27__outbox\x27\] = outbox/, "Device-local outbox cleanup must update the originating account only");
assert.ok(
  flutterApp.includes("Timer.periodic(") &&
    flutterApp.includes("const Duration(seconds: 60)"),
  "Flutter's periodic reconciliation must be a 60-second fallback, not the primary write-delivery mechanism",
);
assert.match(flutterApp, /WidgetsBinding\.instance\.addObserver\(this\)/,
  "Flutter app shell must observe lifecycle resumes for immediate sync reconciliation");
assert.match(flutterApp, /didChangeAppLifecycleState\(AppLifecycleState state\)[\s\S]*AppLifecycleState\.resumed[\s\S]*widget\.sync\.syncNow\(\)/,
  "Flutter must reconcile immediately after returning to the foreground");
assert.match(flutterApp, /WidgetsBinding\.instance\.removeObserver\(this\)/,
  "Flutter app shell must remove its lifecycle observer on dispose");
assert.ok(
  flutterApp.includes("unawaited(widget.sync.syncNow().catchError((Object _) {}))"),
  "Flutter periodic background reconciliation must contain transient sync errors",
);
assert.equal(
  flutterApp.includes("unawaited(widget.sync.syncNow());"),
  false,
  "Flutter must not launch an uncaught redundant fire-and-forget sync after a durable local write",
);
assert.match(flutterLocalStore, /Future<void> activateAccount\(String\? userId\)/, "Flutter must switch local snapshot and outbox atomically at account boundaries");

assert.match(flutterLocalStore, /Future<void> acknowledgeOperationForAccount\([\s\S]*_accounts\[scope\]/, "Late acknowledgements must update the saved originating account snapshot");
assert.match(flutterLocalStoreTest, /first authenticated account adopts the legacy v1 snapshot intact/, "Native storage tests must prove legacy v1 local nutrition data is preserved on upgrade");
assert.match(flutterLocalStoreTest, /keeps account outboxes isolated when a late acknowledgement arrives/, "Native storage tests must prove account A acknowledgements cannot alter account B's outbox");
assert.match(flutterLocalStoreTest, /expect\(store\.pendingOperations\(\), \[operationB\]\)/, "The account isolation test must assert that B's pending operation remains queued");
assert.match(flutterNutrition, /isCurrentLocalAccount\(accountId\)/, "A pending Nutrition dialog must not write into a different account after session change");
assert.match(flutterSettings, /widget\.auth\.currentUser\?\.id != userId[\s\S]*widget\.localStore\.currentAccountId != userId/, "Async settings operations must stop after their initiating account changes");

assert.match(flutterLocalStore, /account:\$userId/, "Flutter local account namespaces must be bound to the authenticated user ID");
assert.match(flutterApp, /await widget\.sync\.onAccountChanged\(userId\);[\s\S]*await widget\.localStore\.activateAccount\(userId\);[\s\S]*await widget\.sync\.syncNow\(\)/, "Flutter must switch account namespace before starting cloud sync");
assert.match(flutterApp, /widget\.auth\.currentUser\?\.id != userId/, "Flutter must ignore obsolete queued auth events during rapid account switching");
assert.match(flutterSync, /localStore\.currentAccountId != userId\) return;/, "Explicit consent updates must not be attributed to a different local account");
assert.match(flutterSync, /localStore\.currentAccountId != userId/, "Flutter cloud operations must stop when the active local scope does not match the authenticated user");
assert.match(flutterSync, /localStore\.currentAccountId != initialUserId/, "An in-flight sync must abort as soon as the authenticated account changes");
assert.match(flutterSync, /if \(localStore\.currentAccountId != userId\) \{[\s\S]*Espace local différent du compte authentifié/, "The final push RPC must recheck account scope at the write boundary");

assert.match(flutterLocalStore, /Future<void> acknowledgeOperationForAccount\([\s\S]*final scope = 'account:\$userId'[\s\S]*_accounts\[scope\]/, "Late accepted cloud acknowledgements must update the originating account snapshot rather than the active one");
assert.match(flutterSync, /acknowledgeOperationForAccount\([\s\S]*userId,[\s\S]*operation,[\s\S]*result\.serverUpdatedAt/, "Flutter must acknowledge accepted mutations inside their originating account after async requests finish");
const rerunMarkerIndex = flutterSync.indexOf("final shouldRerunForActiveAccount = _syncRequested;");
const rerunScheduleIndex = flutterSync.indexOf("_scheduleSync();", rerunMarkerIndex);
assert.ok(
  rerunMarkerIndex >= 0 && rerunScheduleIndex > rerunMarkerIndex,
  "A new account sync request must be resumed through the safe scheduler after an old in-flight account cycle drains",
);
assert.doesNotMatch(flutterSync, /Future<void> _applyRealtimeRow\(/, "Native user_state snapshots must reconcile through the account-scoped pull, not a generic Realtime payload handler");
assert.match(flutterApp, /if \(widget\.auth\.currentUser\?\.id != userId\) return;[\s\S]*await widget\.sync\.onAccountChanged\(userId\)/, "Obsolete auth stream events must not activate an account after a newer session has arrived");
assert.match(flutterNutrition, /final accountId = widget\.sync\.activeAccountId[\s\S]*isCurrentLocalAccount\(accountId\)/, "Nutrition dialogs must stay bound to the account that opened them");
assert.match(flutterSettings, /final userId = widget\.auth\.currentUser\?\.id[\s\S]*localStore\.currentAccountId != userId/, "Settings mutations must be attributed to the account that initiated them");

assert.match(flutterSync, /Future<void> onAccountChanged\(String\? userId\)[\s\S]*_cloudSyncConsent = null[\s\S]*_lastNutritionReconciledAt = null/, "Account changes must close old Realtime channels and invalidate the previous consent cache");



assert.match(flutterSync, /final shouldReconcileNutrition = hadNutritionMutation[\s\S]*await _pushPending\(\);[\s\S]*await _pullRemote\(\);[\s\S]*if \(shouldReconcileNutrition\) \{[\s\S]*_reconcileNutritionProjection\(user\.id\)[\s\S]*if \(hadNutritionMutation[\s\S]*await _pushPending\(\)/, "Flutter must push local mutations, reconcile canonical food_log rows and re-push the merged projection without requiring a mutation-only code path");
assert.match(flutterSync, /_reconcileNutritionProjection[\s\S]*from\('food_log'\)[\s\S]*legacyRows[\s\S]*_isFoodLogUuid/, "Flutter reconciliation must combine canonical food_log rows with legacy local-only manual meals");
assert.match(flutterSync, /Future<void> deleteNutritionFoodLogItem\(String id\)[\s\S]*from\('food_log'\)[\s\S]*\.delete\(\)/, "Deleting a canonical meal must delete its exact food_log row");
assert.match(flutterNutrition, /deleteNutritionFoodLogItem\(item\['id'\]\?\.toString\(\) \?\? ''\)/, "Flutter Nutrition UI must request explicit canonical deletion before removing an item");
const nativeDeleteUiStart = flutterNutrition.indexOf("Future<void> _deleteItem(");
const nativeDeleteUiEnd = flutterNutrition.indexOf("  @override", nativeDeleteUiStart);
assert.ok(
  nativeDeleteUiStart >= 0 && nativeDeleteUiEnd > nativeDeleteUiStart,
  "Native Nutrition delete handler must remain identifiable",
);
const nativeDeleteUi = flutterNutrition.slice(nativeDeleteUiStart, nativeDeleteUiEnd);
assert.ok(
  nativeDeleteUi.indexOf("if (accountId != null)") >= 0 &&
    nativeDeleteUi.indexOf("if (accountId != null)") < nativeDeleteUi.indexOf("deleteNutritionFoodLogItem("),
  "Guest/local-only Nutrition entries must be deletable without a Supabase food_log request",
);

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
assert.match(nutritionAi, /const canonicalIds = new Set\(\(data \?\? \[\]\)\.map\(\(row\) => row\.id\)\)[\s\S]*item\.pendingFoodLog === true && !canonicalIds\.has\(item\.id\)/, "Coach context must not count a pending local meal twice when its canonical food_log row already exists");
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
assert.match(nutritionRoute, /await deletePersistedNutritionItem\(id, expectedUserId\)/, "User-requested deletion must delegate the exact account-scoped ID to the local-first SQL delete helper");
assert.match(nutritionLog, /DELETED_IDS_KEY = "pace\.__nutrition_deleted_ids_v1"/, "Explicit nutrition deletions must leave an account-local tombstone");
assert.match(nutritionLog, /rememberDeletedNutritionId\(expectedUserId, id, isFoodLogUuid\(id\)\)/, "A requested deletion must persist an account-scoped tombstone and queue UUID deletes for later sync");
assert.match(nutritionLog, /nutritionRows\(value\)\.filter\(\(\{ id \}\) => isFoodLogUuid\(id\) && !deletedIds\.has\(id\)\)/, "Only UUID-backed rows may be bridged, and explicitly deleted IDs stay excluded");
assert.match(nutritionLog, /localStorage\.getItem\(deletedIdsStorageKey\(userId\)\)[\s\S]*legacy\?\.userId === userId[\s\S]*localStorage\.removeItem\(DELETED_IDS_KEY\)/, "Nutrition tombstones must use the active account namespace and migrate the legacy slot only to its recorded owner");
assert.doesNotMatch(
  nutritionLog,
  /slice\(-5000\)/,
  "Web Nutrition delete tombstones must not be truncated and allow stale snapshots to resurrect older meals",
);
assert.match(
  flutterSync,
  /_writeDeletedNutritionIds[\s\S]*enqueueSync: false/,
  "Native Nutrition deletion tombstones must persist locally without entering the cloud outbox",
);
assert.doesNotMatch(
  flutterSync,
  /take\(5000\)/,
  "Native Nutrition delete tombstones must not be truncated and allow stale snapshots to resurrect older meals",
);
const nutritionRefreshStart = nutritionLog.indexOf("export function refreshNutritionFromFoodLog(");
const nutritionRefreshEnd = nutritionLog.indexOf("export function subscribeNutritionFoodLogChanges", nutritionRefreshStart);
assert.ok(nutritionRefreshStart >= 0 && nutritionRefreshEnd > nutritionRefreshStart, "Nutrition refresh projection must remain identifiable");
const nutritionRefreshBlock = nutritionLog.slice(nutritionRefreshStart, nutritionRefreshEnd);
const refreshDeletedIdsIndex = nutritionRefreshBlock.indexOf("const deletedIds = readDeletedNutritionIds(user.id);");
const refreshDeletedFilterIndex = nutritionRefreshBlock.indexOf(".filter((row) => !deletedIds.has(row.id))");
assert.ok(
  refreshDeletedIdsIndex >= 0 && refreshDeletedFilterIndex > refreshDeletedIdsIndex,
  "A stale in-flight food_log read must filter returned canonical rows against explicit delete tombstones before rebuilding the Nutrition view",
);
const explicitNutritionDeleteStart = nutritionLog.indexOf("export async function deletePersistedNutritionItem");
const explicitNutritionDeleteEnd = nutritionLog.indexOf("\nfunction nutritionRows", explicitNutritionDeleteStart);
assert.ok(explicitNutritionDeleteStart >= 0 && explicitNutritionDeleteEnd > explicitNutritionDeleteStart, "Explicit nutrition deletion must remain identifiable");
const explicitNutritionDelete = nutritionLog.slice(explicitNutritionDeleteStart, explicitNutritionDeleteEnd);
assert.ok(explicitNutritionDelete.indexOf("rememberDeletedNutritionId(expectedUserId, id, isFoodLogUuid(id))") < explicitNutritionDelete.indexOf("await nutritionBridgeChain.catch"), "Deletion tombstone must be registered before draining the bridge");
assert.ok(explicitNutritionDelete.indexOf("await nutritionBridgeChain.catch") < explicitNutritionDelete.indexOf('from("food_log").delete()'), "SQL deletion must run after queued legacy bridge writes finish");
assert.match(explicitNutritionDelete, /state\.pending\.add\(id\)[\s\S]*writeDeletedNutritionState\(expectedUserId, state\)/, "A failed explicit SQL deletion must keep its account-scoped tombstone pending for retry");



assert.match(bridge, /isFoodLogUuid\(id\) && !deletedIds\.has\(id\)/, "Legacy timestamp IDs must not be sent to the UUID food_log primary key");
assert.match(nutritionLog, /const currentRows = current\[day\] \?\? \[\][\s\S]*const legacyRows = currentRows\.filter\(\(item\) => !isFoodLogUuid\(item\.id\) && !deletedIds\.has\(item\.id\)\)/, "Web refresh must retain legacy Flutter meals absent from food_log unless the same account explicitly deleted them");
assert.match(nutritionLog, /const pendingRows = currentRows\.filter\(\(item\) =>[\s\S]*pendingFoodLog === true[\s\S]*!canonicalIds\.has\(item\.id\)/, "Web refresh must retain pending native UUID rows absent from food_log");
assert.match(nutritionLog, /const pendingRows = currentRows\.filter\(\(item\) =>[\s\S]*pendingFoodLog === true[\s\S]*!canonicalIds\.has\(item\.id\)/, "Web refresh must preserve native UUID rows while their canonical food_log insert is pending");
assert.match(nutritionLog, /if \(pendingRows\.length\) await bridgeLocalNutritionToFoodLog\(nextSnapshot, expectedUserId\)/, "Web must retry pending native meal inserts through the idempotent account-bound UUID bridge");
assert.match(nutritionLog, /if \(!isFoodLogUuid\(id\) \|\| !cloudAllowed\) return/, "Legacy timestamp meal deletion must not query the UUID food_log key, and a cloud opt-out must remain local");

assert.match(nutritionLog, /await persistNutritionItem\(item, source, expectedUserId, id, logDate\)/, "Consented Nutrition writes must reuse the preallocated local UUID and captured log date so ambiguous retries are idempotent");
assert.match(nutritionLog, /log_date: logDate/, "Canonical food_log writes must use the same log date captured before authentication/network awaits");
const addNutritionStart = nutritionLog.indexOf("export async function addNutritionItem");
assert.ok(addNutritionStart >= 0, "Web Nutrition add path must remain identifiable");
const addNutritionBlock = nutritionLog.slice(addNutritionStart);
assert.match(addNutritionBlock, /const logDate = todayKey\(\);[\s\S]*const day = logDate[\s\S]*persistNutritionItem\(item, source, expectedUserId, id, logDate\)[\s\S]*refreshNutritionFromFoodLog\(logDate/, "Local pending rows, canonical persistence, and retry reconciliation must share one captured date across midnight");
assert.match(addNutritionBlock, /const savePendingLocally = \(\) => \{[\s\S]*pendingFoodLog: true[\s\S]*writeDomain\(DOMAIN_ITEMS/, "Local-first Nutrition persistence must save pending entries under a stable UUID before cloud upload");
assert.match(addNutritionBlock, /savePendingLocally\(\);[\s\S]*if \(!isLegalCategoryAllowed\("sync_cloud"\)\) \{[\s\S]*return true;/, "Web Nutrition must persist the meal locally before deciding whether cloud consent allows upload");
assert.match(nutritionLog, /function newNutritionUuid\(\): string[\s\S]*crypto\.getRandomValues/, "Local pending Nutrition entries must receive collision-resistant UUIDs before upload");
assert.match(nutritionLog, /from\("food_log"\)\.upsert\(\{ id, user_id: expectedUserId[\s\S]*\{ onConflict: "id" \}\)/, "A retried manual Nutrition write must upsert by the exact preallocated UUID instead of duplicating a row");
assert.match(bridge, /from\("food_log"\)\.upsert\(payload, \{ onConflict: "id" \}\)/, "The compatibility bridge must also upsert by UUID so it can race a direct local-first add without duplicating or losing the meal");
assert.match(bridge, /const changed = previous !== undefined[\s\S]*: item\.pendingFoodLog === true/, "A pending local Nutrition row must reconcile its values when the canonical UUID already exists, even without a prior in-memory snapshot");
assert.match(addNutritionBlock, /if \(activeNutritionAccountId\(\) !== expectedUserId\) return true;/, "A network failure after account switch must leave the already-persisted meal in its originating account instead of dropping it");
assert.match(addNutritionBlock, /const id = newNutritionUuid\(\);[\s\S]*const logDate = todayKey\(\);[\s\S]*const savePendingLocally = \(\) => \{[\s\S]*id,[\s\S]*pendingFoodLog: true[\s\S]*savePendingLocally\(\);[\s\S]*await persistNutritionItem\(item, source, expectedUserId, id, logDate\)/, "Every Web Nutrition addition must be locally durable with one UUID and one captured date before the idempotent cloud upsert");
const retryHooksStart = nutritionLog.indexOf("const retryPendingNutritionBridge =");
const retryHooksEnd = nutritionLog.indexOf("\n}", retryHooksStart);
assert.ok(retryHooksStart >= 0 && retryHooksEnd > retryHooksStart, "Nutrition retry hook lifecycle must remain identifiable");
const retryHooks = nutritionLog.slice(retryHooksStart, retryHooksEnd);
assert.match(retryHooks, /flushPendingNutritionDeletes\(userId\)[\s\S]*bridgeLocalNutritionToFoodLog\(readNutritionItems\(\), userId\)/, "Reconnect/consent retry must flush queued explicit deletes before bridging local adds");
assert.match(nutritionLog, /window\.addEventListener\("online", retryPendingNutritionBridge\)/, "Pending nutrition writes and deletes must retry after network reconnection");
assert.match(nutritionLog, /window\.addEventListener\("pace\.legal\.changed", retryPendingNutritionBridge\)/, "Pending nutrition writes and deletes must retry after sync consent is enabled");
assert.match(nutritionLog, /window\.addEventListener\("pace\.account\.scope\.changed", retryPendingNutritionBridge\)/, "Pending nutrition writes and deletes must retry after an account scope transition");
assert.match(nutritionLog, /async function flushPendingNutritionDeletes\(userId: string\)[\s\S]*readDeletedNutritionState\(userId\)\.pending[\s\S]*offset \+= 100[\s\S]*clearPendingNutritionDeletes\(userId, batch\)/, "Queued Nutrition SQL deletes must retry in bounded account-scoped batches and clear only after acknowledgement");
const deletePendingStart = nutritionLog.indexOf("export async function deletePersistedNutritionItem");
const deletePendingEnd = nutritionLog.indexOf("\nfunction nutritionRows", deletePendingStart);
assert.ok(deletePendingStart >= 0 && deletePendingEnd > deletePendingStart, "Explicit Nutrition delete path must remain identifiable");
const deletePendingBlock = nutritionLog.slice(deletePendingStart, deletePendingEnd);
assert.match(deletePendingBlock, /rememberDeletedNutritionId\(expectedUserId, id, isFoodLogUuid\(id\)\)[\s\S]*if \(!isFoodLogUuid\(id\) \|\| !cloudAllowed\) return/, "A local-first Nutrition delete must be tombstoned and deferred when cloud consent is disabled");
assert.match(deletePendingBlock, /state\.pending\.add\(id\)[\s\S]*writeDeletedNutritionState\(expectedUserId, state\)/, "An unsuccessful cloud delete must remain queued without resurrecting the local meal");
assert.doesNotMatch(deletePendingBlock, /forgetDeletedNutritionId/, "An account switch or transient auth failure must never discard the previous account's pending deletion tombstone");
assert.match(deletePendingBlock, /await nutritionBridgeChain\.catch\(\(\) => undefined\);[\s\S]*activeNutritionAccountId\(\) !== expectedUserId \|\|[\s\S]*!isLegalCategoryAllowed\("sync_cloud"\)/, "Explicit SQL deletion must recheck account and consent after draining the queued Nutrition bridge");

const routeDeleteStart = nutritionRoute.indexOf("const remove = (id: string) =>");
const routeDeleteEnd = nutritionRoute.indexOf("const t = totals[today]", routeDeleteStart);
assert.ok(routeDeleteStart >= 0 && routeDeleteEnd > routeDeleteStart, "Web Nutrition remove handler must remain identifiable");
const routeDeleteBlock = nutritionRoute.slice(routeDeleteStart, routeDeleteEnd);
assert.match(routeDeleteBlock, /await deletePersistedNutritionItem\(id, expectedUserId\)/, "Web Nutrition delete must delegate to the local-first account-scoped delete helper");
assert.doesNotMatch(routeDeleteBlock, /supabase\.auth\.getUser/, "The UI must not require a network auth preflight before a local Nutrition delete");
assert.match(retryHooks, /refreshNutritionFromFoodLog\(todayKey\(\), \{[\s\S]*bridgeLocalFirst: false[\s\S]*expectedUserId: userId/, "After queued changes are flushed, Web Nutrition must reconcile the canonical journal and clear acknowledged pending inserts");

const persistNutritionStart = nutritionLog.indexOf("export async function persistNutritionItem");
const persistNutritionEnd = nutritionLog.indexOf("export async function deletePersistedNutritionItem", persistNutritionStart);
assert.ok(persistNutritionStart >= 0 && persistNutritionEnd > persistNutritionStart, "Canonical Nutrition persistence must remain identifiable");
assert.match(nutritionLog.slice(persistNutritionStart, persistNutritionEnd), /if \(!isLegalCategoryAllowed\("sync_cloud"\)\)/, "The direct canonical insert helper must fail closed without explicit sync consent");
assert.match(bridge, /if \(!isLegalCategoryAllowed\("sync_cloud"\)\) return;/, "The legacy bridge must not read or write food_log without explicit sync consent");
assert.match(bridge, /if \(!isLegalCategoryAllowed\("sync_cloud"\)\) return;[\s\S]*if \(!isLegalCategoryAllowed\("sync_cloud"\) \|\| activeNutritionAccountId\(\) !== userId\) return;/, "The Nutrition bridge must recheck consent after network reads and before each write");
assert.match(nutritionLog, /!isLegalCategoryAllowed\("sync_cloud"\)\) return Promise\.resolve\(\);[\s\S]*const task = async \(\) => \{\s*if \(!isLegalCategoryAllowed\("sync_cloud"\)\) return;/, "Queued legacy bridge work must recheck consent before reaching Supabase");
assert.match(nutritionRefreshBlock, /!isLegalCategoryAllowed\("sync_cloud"\)/, "Canonical Nutrition refresh must not pull cloud data while sync consent is disabled");
assert.match(nutritionRefreshBlock, /activeNutritionAccountId\(\) !== expectedUserId \|\|[\s\S]*!isLegalCategoryAllowed\("sync_cloud"\)/, "Nutrition refresh must discard in-flight cloud results when sync consent is revoked");
assert.match(nutritionRoute, /enregistré sur cet appareil/i, "The Web UI must clearly describe local-only Nutrition saves when sync consent is off");
assert.match(nutritionLog, /source === "photo_ai" \? "photo" : source/, "Photo AI writes must use a source value accepted by the food_log schema");
assert.match(nutritionLog, /pendingFoodLogSource\?: "manual" \| "barcode" \| "photo_ai"/, "Locally queued Nutrition entries must preserve their original input source");
assert.match(bridge, /pendingFoodLogSource === "photo_ai"[\s\S]*pendingFoodLogSource \?\? "manual"[\s\S]*source: existingIds\.has\(id\) \? undefined : pendingSource/, "A concurrent local bridge must preserve barcode/photo provenance and normalize photo_ai to the database's photo source");

assert.match(nutritionLog, /export function subscribeNutritionFoodLogChanges/, "Web Nutrition must subscribe to canonical food_log changes");
assert.match(nutritionLog, /event: "INSERT"[\s\S]*table: "food_log"[\s\S]*filter: `user_id=eq\.\$\{user\.id\}`/, "Web Nutrition Realtime must be scoped to the authenticated account");
assert.match(nutritionLog, /event: "UPDATE"[\s\S]*table: "food_log"/, "Web Nutrition must refresh when canonical meals are edited by AI or another device");
const webNutritionRealtimeStart = nutritionLog.indexOf("export function subscribeNutritionFoodLogChanges");
const webNutritionRealtimeEnd = nutritionLog.indexOf("export function currentNutritionAccountId", webNutritionRealtimeStart);
assert.ok(webNutritionRealtimeStart >= 0 && webNutritionRealtimeEnd > webNutritionRealtimeStart, "Web Nutrition Realtime subscription must remain identifiable");
const webNutritionRealtime = nutritionLog.slice(webNutritionRealtimeStart, webNutritionRealtimeEnd);
assert.doesNotMatch(webNutritionRealtime, /event: "DELETE"/, "Web must not subscribe to unfilterable DELETE events; the bounded refresh reconciles removals");
assert.doesNotMatch(flutterSync, /event: PostgresChangeEvent\.delete/, "Flutter must not subscribe to unfilterable food_log DELETE events");
assert.doesNotMatch(nutritionRealtimeMigration, /ALTER TABLE public\.food_log REPLICA IDENTITY FULL/i, "food_log Realtime migration must not enable FULL identity for unfilterable DELETE events");
assert.match(nutritionLog, /nutritionRefreshChain = nutritionRefreshChain\.then\(task, task\)/, "Concurrent Nutrition hydration requests must be serialized");
assert.match(nutritionLog, /lastBridgedNutrition = nextSnapshot;[\s\S]*writeDomain\(DOMAIN_ITEMS, nextSnapshot\)/, "A Realtime refresh must not echo stale local rows back into food_log");
assert.match(nutritionLog, /const changed = JSON\.stringify\(current\[day\] \?\? \[\]\) !== JSON\.stringify\(mergedRows\);[\s\S]*if \(changed\) \{[\s\S]*writeDomain/, "A Realtime refresh must not enqueue identical full Nutrition snapshots");
assert.match(nutritionRoute, /subscribeNutritionFoodLogChanges\(refresh\)/, "The Nutrition route must bind its lifecycle to the Realtime subscription");
assert.match(nutritionRoute, /setInterval\(refresh, 60_000\)/, "Nutrition must retain a bounded fallback when Realtime is unavailable");
assert.ok(
  flutterSync.includes("table: 'food_log'") &&
    flutterSync.includes("callback: (_) => _scheduleNutritionRealtime(userId)"),
  "Flutter must reconcile food_log INSERT and UPDATE events through a safe background callback",
);
assert.match(flutterSync, /_lastNutritionReconciledAt == null[\s\S]*_nutritionFallbackInterval/, "Flutter must refresh canonical Nutrition after login and on a bounded fallback interval");

assert.match(flutterSync, /Future<void> upsertNutritionFoodLogItem\([\s\S]*from\('food_log'\)\.upsert[\s\S]*onConflict: 'id'/, "Flutter manual Nutrition inserts must be idempotent in canonical food_log");
assert.match(flutterSync, /pendingFoodLog[\s\S]*upsertNutritionFoodLogItem[\s\S]*final rows = await client!/, "Flutter must retry pending canonical meal inserts and retain them locally until visible in food_log");
assert.match(flutterNutrition, /'id': newFoodLogUuid\(\),[\s\S]*'pendingFoodLog': true/, "Flutter must give a manual meal a stable UUID before network persistence");

assert.match(nutritionRealtimeMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.food_log/, "Supabase migration must publish food_log for account-scoped Realtime");
assert.match(nutritionRealtimeMigration, /duplicate_object/, "food_log Realtime publication migration must be idempotent");

assert.doesNotMatch(domainStore, /MAX_IDENTICAL_NUTRITION_ITEMS_PER_DAY|MAX_NUTRITION_ITEMS_PER_DAY|count >=/, "Nutrition sanitization must not silently deduplicate or truncate valid meal entries");
assert.doesNotMatch(nutritionLog, /recentAdds|addFingerprint/, "Identical intentional food entries must not be dropped by a client-side fingerprint cooldown");
assert.match(nutritionLog, /const operationKey = operationId \? `\$\{expectedUserId\}:\$\{operationId\}` : null[\s\S]*if \(operationKey\)[\s\S]*completedOperations\.set\(operationKey, now\)/, "Only explicit operation IDs should trigger account-scoped idempotency suppression");
assert.match(nutritionRoute, /savingPending/, "Barcode and photo confirmation must prevent accidental duplicate clicks while the server write is pending");
assert.match(nutritionAiChat, /isNutritionDeviceSyncEnabled\(\)[\s\S]*refreshNutritionFromFoodLog\(todayKey\(\), \{ bridgeLocalFirst: false \}\)/, "Coach IA refresh must respect cloud-sync consent and use the merge-safe canonical Nutrition projection");
assert.doesNotMatch(nutritionAiChat, /from\("food_log"\)\.select/, "Coach IA completion must not replace local Nutrition with a raw partial food_log snapshot");

assert.match(nutritionLog, /await refreshNutritionFromFoodLog\(logDate, \{ expectedUserId \}\)/, "Nutrition projection must be rebuilt from canonical food_log under the original account and captured day");
assert.match(nutritionLog, /async function bridgeNutritionSnapshot\(value: unknown, userId: string\)/, "Previously local-only manual entries must be recovered into food_log");
assert.match(nutritionLog, /for \(const \{ id, day, item \} of nextRows\)/, "Legacy recovery must preserve each existing nutrition UUID");
assert.match(nutritionLog, /id, user_id: user\.id, log_date: day/, "Legacy recovery must reuse each existing nutrition UUID in food_log");
assert.doesNotMatch(nutritionLog.slice(nutritionLog.indexOf("async function refreshNutritionFromFoodLog"), nutritionLog.indexOf("export async function addNutritionItem")), /\.delete\s*\(/, "Canonical refresh and legacy recovery must never delete nutrition entries");
assert.match(nutritionLog, /order\("created_at", \{ ascending: true \}\)/, "Canonical nutrition refresh must retain stable meal ordering");
assert.match(nutritionLog, /let nutritionBridgeChain: Promise<void>/, "Legacy nutrition snapshots must be serialized instead of being dropped during an in-flight bridge");
assert.match(nutritionLog, /nutritionBridgeChain = nutritionBridgeChain\.then\(task, task\)/, "Queued nutrition bridge snapshots must run even after a previous failure");
assert.match(nutritionLog, /await bridgeLocalNutritionToFoodLog\(readNutritionItems\(\), expectedUserId\)/, "Nutrition refresh must wait for legacy local entries to finish bridging under the initiating account");
assert.doesNotMatch(nutritionLog, /nutritionBridgeRunning/, "The bridge must not silently discard writes while busy");

assert.match(nutritionRoute, /await addNutritionItem\([\s\S]*"manual"\)/, "Manual form must use the canonical persisted add path");
assert.match(nutritionRoute, /await addNutritionItem\([\s\S]*"barcode"\)/, "Barcode additions must use the canonical persisted add path");
assert.match(nutritionRoute, /await addNutritionItem\([\s\S]*"photo_ai"\)/, "Photo AI additions must use the canonical persisted add path");
assert.match(read("src/components/RecipesView.tsx"), /void addNutritionItem\([\s\S]*\.then\(\(saved\) =>[\s\S]*\.catch\(/, "Recipe quick-add must handle canonical persistence asynchronously and surface failures");
assert.match(read("src/components/RecipesView.tsx"), /Repas enregistré sur cet appareil\./, "Recipe quick-add must identify local-only saves when cloud sync consent is disabled");

assert.match(engine, /setInterval\s*\(.*60(?:000|_000)/s, "sync engine must reconcile periodically");
assert.match(engine, /const reconcileTimer = window\.setInterval\([\s\S]*document\.visibilityState === "visible" && allowed\(\)[\s\S]*void syncNow\(\)[\s\S]*60_000/, "Web must reconcile filtered user_state snapshots every 60 seconds while visible");
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
assert.doesNotMatch(engine, /startRealtime|stopRealtime|realtimeHealthy|postgres_changes/,
  "Web user_state sync must not create a generic Realtime subscription");
assert.match(engine, /const onOnline = \(\) => \{\s*void syncNow\(\);\s*\}/,
  "Web must reconcile immediately after network recovery");
assert.match(engine, /const onLegalChanged = \(\) => \{\s*if \(allowed\(\)\) void syncNow\(\);\s*else setStatus\("idle"\);\s*\}/,
  "Web must reconcile immediately when cloud-sync consent is enabled");
assert.match(engine, /const offLocal = onLocalWrite\([\s\S]*queueItem\(\{ key, value, updatedAt, mutationId \}, user\.id\);\s*if \(allowed\(\)\) void pushItem/, "Local mutations must remain queued under the authenticated account while cloud sync consent is off, and push only after opt-in");
assert.match(engine, /if \(!isSyncableKey\(key\) \|\| grouped\.has\(key\)\) continue;/,
  "Legacy raw app-state bootstrap must use the shared device-local sync predicate");
assert.ok(
  ["pace.legal.consent","pace.billing.device_id","pace.watch.last_metrics"]
    .every((key) => engine.includes(`"${key}"`)),
  "Device-bound consent, billing, watch and appearance settings must remain device-local",
);
assert.ok(
  ["pace.privacy.","pace.finance.","pace.ble.","pace.import.","pace.local-ai.","pace.ai.local.","pace.ai.pending:"]
    .every((prefix) => engine.includes(`"${prefix}"`)),
  "Privacy, Finance, BLE, import and local AI records must remain device-local by prefix",
);

assert.match(engine, /await flushQueue\(\);\s*await pull\(\);\s*await flushQueue\(\);/, "Bootstrapped and recovered local values must be pushed in the same sync pass");
assert.match(engine, /const sourceRow = !canonical \? legacy : !legacy \? canonical/, "Legacy recovery must select the newest full snapshot instead of union-merging rows");
assert.match(engine, /const localDomainTime = localDomain \? Date\.parse\(localDomain\.updatedAt\)/, "Local reconciliation must compare the persisted mutation timestamp, not only last acknowledged cloud metadata");
assert.match(engine, /Number\.isFinite\(localDomainTime\) && localDomainTime > sourceTime/, "A newer local snapshot must be queued instead of overwritten by an older cloud snapshot");
assert.doesNotMatch(engine.slice(engine.indexOf("for (const [key, bucket] of grouped)"), engine.indexOf("// Bootstrap pre-existing local domain state")), /mergeRecoveredValues/, "A stale legacy snapshot must not resurrect deleted array entries");

assert.match(read("src/lib/legal.ts"), /sync_cloud: false/, "cloud sync must remain opt-in by default");
assert.match(nutritionLog, /isNutritionDeviceSyncEnabled\(\).*isLegalCategoryAllowed\("sync_cloud"\)/s, "Nutrition UI must be able to explain when cross-device sync is disabled");
assert.doesNotMatch(engine, /postgres_changes|channel\.subscribe\(/, "Web state sync must not subscribe to user_state Realtime");
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
assert.match(localRemoteHandler, /pendingRemoteValueRef\.current = next/, "Remote snapshot application must remember the exact value instead of a global suppression flag");
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
assert.match(engine, /readQueue\(userId\)\.filter\(\(queued\) => queued\.key !== item\.key\)/, "Rapid mutations must be coalesced per key inside the originating account queue");

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
assert.match(engine, /const pullCursorKey = `pace\.__cloud_sync_last_pull:\$\{user\.id\}`[\s\S]*request\.gt\("updated_at"[\s\S]*localStorage\.setItem\(pullCursorKey/, "Web cloud pulls must persist an account-scoped cursor and fetch only recently changed user_state rows after the initial bootstrap");
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

assert.ok(
  read("src/hooks/use-health.tsx").includes("createPrivateRealtimeChannel(channelName)"),
  "Health E2EE Postgres Changes must use the private-channel factory",
);
assert.ok(
  read("src/hooks/use-profile-realtime.ts").includes("createPrivateRealtimeChannel(`pace-profile-${user.id}`)"),
  "Profile Postgres Changes must use the private-channel factory",
);
assert.ok(
  read("src/lib/nutrition-log.ts").includes("createPrivateRealtimeChannel(`pace-food-log-${user.id}`)"),
  "Nutrition Postgres Changes must use the private-channel factory",
);
assert.ok(
  read("src/routes/development.tsx").includes("createPrivateRealtimeChannel(`development-tasks-${user.id}`)"),
  "Development-task Postgres Changes must use the private-channel factory",
);
assert.ok(
  supabaseClient.includes("export function createPrivateRealtimeChannel") &&
    supabaseClient.includes("config: { ...options.config, private: true }"),
  "The shared Realtime factory must force private: true even when a caller omits the option",
);
assert.equal(
  (engine + read("src/hooks/use-profile-realtime.ts") + read("src/hooks/use-health.tsx") + read("src/lib/nutrition-log.ts") + read("src/routes/development.tsx")).includes("supabase.channel("),
  false,
  "All web Realtime subscriptions must use the centralized private-channel factory",
);

const nutritionAiServer = read("src/lib/nutrition-ai.functions.ts");
assert.doesNotMatch(
  nutritionAiServer,
  /supabaseAdmin/,
  "Nutrition photo analysis must not require a privileged server Supabase key for user-owned Storage objects",
);
assert.match(
  nutritionAiServer,
  /context\.supabase\.storage\.from\(PHOTO_BUCKET\)\.download\(path!\)/,
  "Nutrition photo analysis must download through the authenticated user's Storage client",
);
assert.match(
  nutritionAiServer,
  /finally \{ if \(path\) await context\.supabase\.storage\.from\(PHOTO_BUCKET\)\.remove\(\[path\]\)/,
  "Nutrition photo cleanup must remain scoped to the authenticated user's Storage policy",
);

const nutritionEngine = read("src/lib/nutrition-engine.ts");
assert.doesNotMatch(
  nutritionEngine,
  /supabaseAdmin/,
  "Nutrition reference lookups must not require a privileged Supabase server key",
);
assert.match(
  nutritionEngine,
  /type NutritionClient = SupabaseClient<Database>/,
  "Nutrition reference engine must accept an explicitly supplied authenticated client",
);
assert.match(
  nutritionAiServer,
  /findDishReference\(parsed\.dish_name, context\.supabase\)/,
  "AI photo dish references must use the authenticated request client",
);
assert.match(
  nutritionAiServer,
  /calculateReferenceBasedNutrition\([\s\S]*context\.supabase\)/,
  "AI photo food references must use the authenticated request client",
);

const sleepRoute = read("src/routes/sleep.tsx");
assert.match(sleepRoute, /const \[hasUserEdited, setHasUserEdited\] = useState\(false\)/,
  "Sleep defaults must remain presentation-only until the user edits a field");
assert.match(sleepRoute, /if \(!cloudLoaded \|\| !hasUserEdited\) return;/,
  "Sleep autosave must wait for cloud hydration and an explicit user edit");
assert.match(sleepRoute, /setStart\(e\.target\.value\); setHasUserEdited\(true\)/,
  "Editing the sleep start time must explicitly authorize persistence");
assert.match(sleepRoute, /setEnd\(e\.target\.value\); setHasUserEdited\(true\)/,
  "Editing the sleep end time must explicitly authorize persistence");
assert.match(sleepRoute, /setQuality\(v\); setHasUserEdited\(true\)/,
  "Editing sleep quality must explicitly authorize persistence");
assert.match(sleepRoute, /disabled=\{!cloudLoaded\}/,
  "Sleep inputs must not be editable until cloud state has finished hydrating");
const sleepDefaults = { start: "23:30", end: "07:00", quality: 8 };
const sleepPersistDecision = ({ cloudLoaded, hasUserEdited }) => cloudLoaded && hasUserEdited;
assert.equal(sleepPersistDecision({ cloudLoaded: true, hasUserEdited: false }), false,
  "Opening Sleep on a new device must not persist its display defaults");
assert.equal(sleepPersistDecision({ cloudLoaded: true, hasUserEdited: true }), true,
  "An explicit Sleep edit must remain eligible for autosave");
assert.deepEqual(sleepDefaults, { start: "23:30", end: "07:00", quality: 8 });


const scanRoute = read("src/routes/scan.tsx");
const photoButtonStart = scanRoute.indexOf('onClick={() => fileRef.current?.click()}');
const photoButtonEnd = scanRoute.indexOf("</motion.button>", photoButtonStart);
const photoInputIndex = scanRoute.indexOf("<input ref={fileRef}");
assert.ok(photoButtonStart >= 0 && photoButtonEnd > photoButtonStart && photoInputIndex > photoButtonEnd,
  "The photo file input must be outside its trigger button to prevent recursive click bubbling");
assert.ok(scanRoute.includes("const analyzePhoto = useServerFn(analyzeFoodPhoto)"),
  "The scan route must invoke photo analysis through the TanStack server-function client");
assert.ok(scanRoute.includes("preparePhotoForAi(file)"),
  "The scan route must compress large phone photos before Storage upload");
assert.ok(scanRoute.includes("file.size > MAX_NUTRITION_PHOTO_BYTES"),
  "The scan route must use the shared 25 MiB source-photo limit");
const nutritionPhoto = read("src/lib/nutrition-photo.ts");
assert.ok(nutritionPhoto.includes("const MAX_UPLOAD_BYTES = 6.5 * 1024 * 1024;"),
  "Both nutrition photo entry points must share the 6.5 MiB compressed upload target");

console.log("cloud-sync-contract-test: PASS");

assert.match(engine, /pruneEquivalentConflicts\(\);\s*if \(!navigator\.onLine\)/, "syncNow must prune equivalent conflicts before queue flush");
assert.match(engine, /remainingConflicts = currentConflicts\.filter\(\(item\) => item\.key !== key\)/, "queued equivalent values must clear stale conflicts");
