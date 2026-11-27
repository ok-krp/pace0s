import { todayKey, onLocalWrite } from "@/lib/storage";
import { writeDomain, readDomain } from "@/lib/domain-store";
import { createPrivateRealtimeChannel, supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";

export type NutritionItem = {
  id: string;
  name: string;
  meal: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  sat?: number;
  sugar?: number;
  fiber?: number;
  salt?: number;
  sodium?: number;
  iron?: number;
  calcium?: number;
  vitC?: number;
  qty: number;
  pendingFoodLog?: boolean;
  pendingFoodLogSource?: "manual" | "barcode" | "photo_ai";
};

const DOMAIN_ITEMS = "nutrition.items";
const DELETED_IDS_KEY = "pace.__nutrition_deleted_ids_v1";
const FOOD_LOG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isFoodLogUuid(id: string) { return FOOD_LOG_UUID.test(id); }
function newNutritionUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function activeNutritionAccountId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const scope = localStorage.getItem("pace.__account_scope");
    return scope && scope !== "__guest__" ? scope : null;
  } catch { return null; }
}
type DeletedNutritionIds = { userId: string; ids: string[]; pending?: string[] };
type DeletedNutritionState = { ids: Set<string>; pending: Set<string> };

function deletedIdsStorageKey(userId: string) {
  return `${DELETED_IDS_KEY}:${encodeURIComponent(userId)}`;
}

function readDeletedNutritionState(userId: string): DeletedNutritionState {
  if (typeof window === "undefined") return { ids: new Set(), pending: new Set() };
  try {
    const scopedRaw = localStorage.getItem(deletedIdsStorageKey(userId));
    if (scopedRaw !== null) {
      const scoped = JSON.parse(scopedRaw) as DeletedNutritionIds;
      return {
        ids: new Set(Array.isArray(scoped.ids) ? scoped.ids.filter((id) => typeof id === "string") : []),
        pending: new Set(Array.isArray(scoped.pending) ? scoped.pending.filter((id) => typeof id === "string") : []),
      };
    }

    // Migrate the former single-user tombstone slot without allowing another
    // account to claim or overwrite the previous account's deletion history.
    const legacy = JSON.parse(localStorage.getItem(DELETED_IDS_KEY) ?? "null") as DeletedNutritionIds | null;
    if (legacy?.userId === userId && Array.isArray(legacy.ids)) {
      const state = {
        ids: new Set(legacy.ids.filter((id) => typeof id === "string")),
        pending: new Set<string>(),
      };
      writeDeletedNutritionState(userId, state);
      localStorage.removeItem(DELETED_IDS_KEY);
      return state;
    }
  } catch { return { ids: new Set(), pending: new Set() }; }
  return { ids: new Set(), pending: new Set() };
}

function writeDeletedNutritionState(userId: string, state: DeletedNutritionState) {
  if (typeof window === "undefined") return;
  // Keep all completed tombstones to block stale snapshots. Pending deletes
  // are kept separately until the server acknowledges the exact account IDs.
  localStorage.setItem(
    deletedIdsStorageKey(userId),
    JSON.stringify({ userId, ids: [...state.ids], pending: [...state.pending] } satisfies DeletedNutritionIds),
  );
}

function readDeletedNutritionIds(userId: string): Set<string> {
  return readDeletedNutritionState(userId).ids;
}

function rememberDeletedNutritionId(userId: string, id: string, pendingCloudDelete = false) {
  if (!id) return;
  const state = readDeletedNutritionState(userId);
  state.ids.add(id);
  if (pendingCloudDelete && isFoodLogUuid(id)) state.pending.add(id);
  writeDeletedNutritionState(userId, state);
}

function clearPendingNutritionDeletes(userId: string, ids: string[]) {
  const state = readDeletedNutritionState(userId);
  for (const id of ids) state.pending.delete(id);
  writeDeletedNutritionState(userId, state);
}

function forgetDeletedNutritionId(userId: string, id: string) {
  const state = readDeletedNutritionState(userId);
  state.ids.delete(id);
  state.pending.delete(id);
  writeDeletedNutritionState(userId, state);
}

async function flushPendingNutritionDeletes(userId: string): Promise<void> {
  if (!isLegalCategoryAllowed("sync_cloud") || activeNutritionAccountId() !== userId) return;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user || user.id !== userId || activeNutritionAccountId() !== userId ||
      !isLegalCategoryAllowed("sync_cloud")) return;

  const pending = [...readDeletedNutritionState(userId).pending].filter(isFoodLogUuid);
  for (let offset = 0; offset < pending.length; offset += 100) {
    const batch = pending.slice(offset, offset + 100);
    if (activeNutritionAccountId() !== userId || !isLegalCategoryAllowed("sync_cloud")) return;
    const { error: deleteError } = await supabase.from("food_log")
      .delete()
      .eq("user_id", userId)
      .in("id", batch);
    if (deleteError) throw deleteError;
    if (activeNutritionAccountId() !== userId || !isLegalCategoryAllowed("sync_cloud")) return;
    clearPendingNutritionDeletes(userId, batch);
  }
}

type NutritionTotals = Record<string, { kcal: number; p: number; c: number; f: number }>;
type NutritionMap = Record<string, NutritionItem[]>;
const completedOperations = new Map<string, number>();
let nutritionBridgeChain: Promise<void> = Promise.resolve();

export function recomputeNutritionTotals(items: NutritionMap): NutritionTotals {
  const totals: NutritionTotals = {};
  for (const [day, list] of Object.entries(items)) {
    totals[day] = list.reduce((a, x) => ({ kcal: a.kcal + Number(x.kcal || 0), p: a.p + Number(x.p || 0), c: a.c + Number(x.c || 0), f: a.f + Number(x.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
  }
  return totals;
}

function readNutritionItems(): NutritionMap { return readDomain<NutritionMap>(DOMAIN_ITEMS, {}).value; }

export function repairNutritionTotals(): void {
  if (typeof window === "undefined") return;
  const items = readNutritionItems();
  if (!Object.keys(items).length) return;
  writeDomain(DOMAIN_ITEMS, items);
}

repairNutritionTotals();

type PersistedNutritionSource = "manual" | "barcode" | "photo_ai";

export async function persistNutritionItem(
  item: Omit<NutritionItem, "id" | "qty"> & { qty?: number },
  source: PersistedNutritionSource = "manual",
  expectedUserId = activeNutritionAccountId(),
  id = newNutritionUuid(),
  logDate = todayKey(),
): Promise<NutritionItem> {
  if (!expectedUserId) throw new Error("Espace utilisateur indisponible.");
  if (!isLegalCategoryAllowed("sync_cloud")) {
    throw new Error("Active « Fonctionnel — Synchronisation » pour enregistrer ce repas dans le cloud.");
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user || user.id !== expectedUserId ||
      activeNutritionAccountId() !== expectedUserId ||
      !isLegalCategoryAllowed("sync_cloud")) {
    throw new Error("La session ou le consentement a changé ; l'ajout Nutrition a été interrompu.");
  }
  const meta = { client_nutrients: { sat: item.sat ?? null, salt: item.salt ?? null, iron: item.iron ?? null, calcium: item.calcium ?? null, vitC: item.vitC ?? null } };
  const foodLogSource = source === "photo_ai" ? "photo" : source;
  const { data, error } = await supabase.from("food_log").upsert({ id, user_id: expectedUserId, log_date: logDate, meal: item.meal, name: item.name, kcal: item.kcal, protein_g: item.p, carbs_g: item.c, fat_g: item.f, fiber_g: item.fiber ?? 0, sugar_g: item.sugar ?? 0, sodium_mg: item.sodium ?? 0, source: foodLogSource, meta }, { onConflict: "id" }).select("id,name,meal,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg").single();
  if (error || !data) throw new Error(error?.message ?? "Enregistrement nutritionnel impossible.");
  return { id: data.id ?? id, name: data.name, meal: data.meal, kcal: Number(data.kcal ?? 0), p: Number(data.protein_g ?? 0), c: Number(data.carbs_g ?? 0), f: Number(data.fat_g ?? 0), fiber: Number(data.fiber_g ?? 0), sugar: Number(data.sugar_g ?? 0), sodium: Number(data.sodium_mg ?? 0), sat: item.sat, salt: item.salt, iron: item.iron, calcium: item.calcium, vitC: item.vitC, qty: item.qty ?? 1 };
}

export async function deletePersistedNutritionItem(
  id: string,
  expectedUserId = activeNutritionAccountId(),
): Promise<void> {
  if (!expectedUserId) throw new Error("Espace utilisateur indisponible.");
  if (activeNutritionAccountId() !== expectedUserId) {
    throw new Error("L'espace local a changé ; la suppression Nutrition a été interrompue.");
  }

  // Local opt-out/offline deletes stay local and become an account-scoped
  // pending SQL delete. They are flushed only after explicit opt-in returns.
  const cloudAllowed = isLegalCategoryAllowed("sync_cloud");
  rememberDeletedNutritionId(expectedUserId, id, isFoodLogUuid(id));
  await nutritionBridgeChain.catch(() => undefined);
  if (!isFoodLogUuid(id) || !cloudAllowed) return;
  if (activeNutritionAccountId() !== expectedUserId ||
      !isLegalCategoryAllowed("sync_cloud")) return;

  let user: { id: string } | null = null;
  try {
    const auth = await supabase.auth.getUser();
    if (auth.error) throw auth.error;
    user = auth.data.user;
  } catch {
    // The exact account-scoped tombstone remains pending. A reconnect or
    // account-scope event will retry it without restoring the deleted meal.
    return;
  }
  if (!user || user.id !== expectedUserId ||
      activeNutritionAccountId() !== expectedUserId ||
      !isLegalCategoryAllowed("sync_cloud")) {
    // Never remove the previous account's tombstone on an auth transition.
    return;
  }

  try {
    const { error } = await supabase.from("food_log").delete().eq("id", id).eq("user_id", expectedUserId);
    if (error) throw error;
    clearPendingNutritionDeletes(expectedUserId, [id]);
  } catch {
    // Preserve the local tombstone and retry this exact UUID later.
    const state = readDeletedNutritionState(expectedUserId);
    state.pending.add(id);
    writeDeletedNutritionState(expectedUserId, state);
  }
}

function nutritionRows(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as Array<{ id: string; day: string; item: NutritionItem }>;
  const rows: Array<{ id: string; day: string; item: NutritionItem }> = [];
  for (const [day, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as NutritionItem;
      if (typeof item.id === "string" && item.id) rows.push({ id: item.id, day, item });
    }
  }
  return rows;
}

let lastBridgedNutrition = readNutritionItems();
let lastBridgedUserId: string | null = null;
async function bridgeNutritionSnapshot(value: unknown, userId: string): Promise<void> {
  if (!isLegalCategoryAllowed("sync_cloud")) return;
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  // A queued snapshot from a previous session must never be written under a
  // different account after an account switch.
  if (!user || user.id !== userId || activeNutritionAccountId() !== userId ||
      !isLegalCategoryAllowed("sync_cloud")) return;
  if (lastBridgedUserId !== userId) {
    lastBridgedUserId = userId;
    lastBridgedNutrition = readNutritionItems();
  }

  const deletedIds = readDeletedNutritionIds(user.id);
  const nextRows = nutritionRows(value).filter(({ id }) => isFoodLogUuid(id) && !deletedIds.has(id));
  const previousById = new Map(nutritionRows(lastBridgedNutrition).map((row) => [row.id, row.item]));
  // A missing ID is not a delete instruction. Only the explicit remove handler
  // is allowed to delete a row from food_log.
  const requestedIds = [...new Set(nextRows.map((row) => row.id))];
  if (activeNutritionAccountId() !== userId) return;
  const { data: existing, error: selectError } = requestedIds.length
    ? await supabase.from("food_log").select("id").eq("user_id", userId).in("id", requestedIds)
    : { data: [], error: null };
  if (selectError) throw selectError;
  if (!isLegalCategoryAllowed("sync_cloud") || activeNutritionAccountId() !== userId) return;
  const existingIds = new Set((existing ?? []).map((row) => row.id));
  for (const { id, day, item } of nextRows) {
    if (!isLegalCategoryAllowed("sync_cloud") || activeNutritionAccountId() !== userId) return;
    const previous = previousById.get(id);
    const changed = previous !== undefined
      ? JSON.stringify(previous) !== JSON.stringify(item)
      : item.pendingFoodLog === true;
    if (existingIds.has(id) && !changed) continue;
    const pendingSource = item.pendingFoodLogSource === "photo_ai"
      ? "photo"
      : item.pendingFoodLogSource ?? "manual";
    const payload = { id, user_id: user.id, log_date: day, meal: item.meal, name: item.name, kcal: Number(item.kcal || 0), protein_g: Number(item.p || 0), carbs_g: Number(item.c || 0), fat_g: Number(item.f || 0), fiber_g: Number(item.fiber || 0), sugar_g: Number(item.sugar || 0), sodium_mg: Number(item.sodium || 0), source: existingIds.has(id) ? undefined : pendingSource, meta: { client_nutrients: { sat: item.sat ?? null, salt: item.salt ?? null, iron: item.iron ?? null, calcium: item.calcium ?? null, vitC: item.vitC ?? null } } };
    if (existingIds.has(id)) {
      const { source: _source, ...update } = payload;
      const { error } = await supabase.from("food_log").update(update).eq("id", id).eq("user_id", user.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("food_log").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      existingIds.add(id);
    }
  }
  lastBridgedNutrition = value && typeof value === "object" && !Array.isArray(value) ? value as NutritionMap : {};
}

function bridgeLocalNutritionToFoodLog(
  value: unknown,
  expectedUserId = activeNutritionAccountId(),
): Promise<void> {
  if (typeof window === "undefined" || !expectedUserId ||
      !isLegalCategoryAllowed("sync_cloud")) return Promise.resolve();
  const task = async () => {
    if (!isLegalCategoryAllowed("sync_cloud")) return;
    const { data: { user }, error } = await supabase.auth.getUser();
    // Bind queued work to the account that owned the local mutation when it
    // was scheduled. Never infer ownership from a later, possibly new session.
    if (error || !user || user.id !== expectedUserId ||
        activeNutritionAccountId() !== expectedUserId ||
        !isLegalCategoryAllowed("sync_cloud")) return;
    await bridgeNutritionSnapshot(value, expectedUserId);
  };
  // Serialize snapshots instead of dropping writes while a previous bridge
  // operation is still in flight. Each snapshot is rechecked against food_log.
  nutritionBridgeChain = nutritionBridgeChain.then(task, task);
  return nutritionBridgeChain;
}

if (typeof window !== "undefined") {
  const retryPendingNutritionBridge = () => {
    const userId = activeNutritionAccountId();
    if (!userId || !isLegalCategoryAllowed("sync_cloud")) return;
    void flushPendingNutritionDeletes(userId)
      .then(() => bridgeLocalNutritionToFoodLog(readNutritionItems(), userId))
      .then(() => refreshNutritionFromFoodLog(todayKey(), {
        bridgeLocalFirst: false,
        expectedUserId: userId,
      }))
      .catch((error) => {
      console.error("[nutrition] pending food_log retry failed", error instanceof Error ? error.message : error);
    });
  };

  onLocalWrite((key, value) => {
    if (key !== "pace.nutrition.items") return;
    void bridgeLocalNutritionToFoodLog(value).catch((error) => {
      console.error("[nutrition] food_log bridge failed", error instanceof Error ? error.message : error);
    });
  });
  window.addEventListener("online", retryPendingNutritionBridge);
  window.addEventListener("pace.legal.changed", retryPendingNutritionBridge);
  window.addEventListener("pace.account.scope.changed", retryPendingNutritionBridge);
  retryPendingNutritionBridge();
}

let nutritionRefreshChain: Promise<void> = Promise.resolve();

export function refreshNutritionFromFoodLog(
  day: string,
  options: { bridgeLocalFirst?: boolean; expectedUserId?: string } = {},
): Promise<void> {
  const expectedUserId = options.expectedUserId ?? activeNutritionAccountId();
  if (!expectedUserId || !isLegalCategoryAllowed("sync_cloud")) return Promise.resolve();
  const task = async () => {
    if (!isLegalCategoryAllowed("sync_cloud") ||
        activeNutritionAccountId() !== expectedUserId) return;
    if (options.bridgeLocalFirst !== false) {
      await bridgeLocalNutritionToFoodLog(readNutritionItems(), expectedUserId);
    }
    if (activeNutritionAccountId() !== expectedUserId) return;
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user || user.id !== expectedUserId ||
        activeNutritionAccountId() !== expectedUserId ||
        !isLegalCategoryAllowed("sync_cloud")) return;
    const { data, error } = await supabase.from("food_log")
      .select("id,name,meal,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg,meta")
      .eq("user_id", expectedUserId).eq("log_date", day).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // An in-flight read for account A must never be projected into account B's
    // shared browser storage after an auth transition.
    if (activeNutritionAccountId() !== expectedUserId ||
        !isLegalCategoryAllowed("sync_cloud")) return;
  // The query may have started before an explicit delete and returned
  // a stale canonical row after the DELETE completed. Filter the database
  // response against the account's tombstones before rebuilding the view.
  const deletedIds = readDeletedNutritionIds(user.id);
  const rows: NutritionItem[] = (data ?? [])
    .filter((row) => !deletedIds.has(row.id))
    .map((row) => {
    const meta = row.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : {};
    const nutrients = meta.client_nutrients && typeof meta.client_nutrients === "object" ? meta.client_nutrients as Record<string, unknown> : {};
    return {
      id: row.id, name: row.name, meal: row.meal,
      kcal: Number(row.kcal ?? 0), p: Number(row.protein_g ?? 0),
      c: Number(row.carbs_g ?? 0), f: Number(row.fat_g ?? 0),
      fiber: Number(row.fiber_g ?? 0), sugar: Number(row.sugar_g ?? 0),
      sodium: Number(row.sodium_mg ?? 0), sat: Number(nutrients.sat ?? 0) || undefined,
      salt: Number(nutrients.salt ?? 0) || undefined, iron: Number(nutrients.iron ?? 0) || undefined,
      calcium: Number(nutrients.calcium ?? 0) || undefined, vitC: Number(nutrients.vitC ?? 0) || undefined,
      qty: 1,
    };
  });
  const current = readNutritionItems();
  // Older native Flutter releases stored manual meals only in user_state
  // with timestamp IDs. Preserve those rows while food_log is canonical for
  // UUID-backed meals; never mistake the legacy rows for SQL UUIDs.
  const currentRows = current[day] ?? [];
  const legacyRows = currentRows.filter((item) => !isFoodLogUuid(item.id) && !deletedIds.has(item.id));
  const canonicalIds = new Set(rows.map((item) => item.id));
  const pendingRows = currentRows.filter((item) =>
    isFoodLogUuid(item.id) && (item as NutritionItem & { pendingFoodLog?: boolean }).pendingFoodLog === true &&
    !canonicalIds.has(item.id) && !deletedIds.has(item.id)
  );
  const mergedRows = [
    ...rows,
    ...legacyRows.filter((item) => !canonicalIds.has(item.id)),
    ...pendingRows,
  ];
  const nextSnapshot = { ...current, [day]: mergedRows };
  // Mark the fetched canonical snapshot before writeDomain emits LOCAL_WRITE;
  // the compatibility bridge must not upload its own remote refresh again.
  lastBridgedNutrition = nextSnapshot;
  if (!isLegalCategoryAllowed("sync_cloud") ||
      activeNutritionAccountId() !== expectedUserId) return;
  const changed = JSON.stringify(current[day] ?? []) !== JSON.stringify(mergedRows);
  if (changed) {
    writeDomain(DOMAIN_ITEMS, nextSnapshot);
    window.dispatchEvent(new Event("pace.nutrition.changed"));
  }
  // A pending native UUID is a durable local intent. Retry its idempotent
  // bridge upload on Web too; never drop it merely because food_log is late.
  if (pendingRows.length) await bridgeLocalNutritionToFoodLog(nextSnapshot, expectedUserId);
  };
  nutritionRefreshChain = nutritionRefreshChain.then(task, task);
  return nutritionRefreshChain;
}

export function subscribeNutritionFoodLogChanges(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  let disposed = false;
  let generation = 0;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  const detach = () => {
    const current = channel;
    channel = null;
    if (current) void supabase.removeChannel(current);
  };

  const attach = async () => {
    const currentGeneration = ++generation;
    detach();
    if (!isNutritionDeviceSyncEnabled()) return;

    const { data: { user }, error } = await supabase.auth.getUser();
    if (disposed || currentGeneration !== generation || error || !user) return;

    const nextChannel = createPrivateRealtimeChannel(`pace-food-log-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "food_log",
        filter: `user_id=eq.${user.id}`,
      }, () => onChange())
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "food_log",
        filter: `user_id=eq.${user.id}`,
      }, () => onChange());

    // Do not subscribe to DELETE: Postgres Changes cannot filter it by
    // user_id, and RLS does not protect DELETE payloads. The bounded refresh
    // below reconciles removals without broadcasting unscoped primary keys.

    channel = nextChannel;
    nextChannel.subscribe((status) => {
      if (!disposed && currentGeneration === generation && status === "SUBSCRIBED") {
        onChange();
      }
    });
    // Initial reconciliation is also required when Realtime is delayed or
    // the project has not yet enabled food_log in supabase_realtime.
    onChange();
  };

  const onConsentChanged = () => { void attach(); };
  const authSubscription = supabase.auth.onAuthStateChange(() => {
    queueMicrotask(() => { void attach(); });
  });
  window.addEventListener("pace.legal.changed", onConsentChanged);
  void attach();

  return () => {
    disposed = true;
    generation++;
    window.removeEventListener("pace.legal.changed", onConsentChanged);
    authSubscription.data.subscription.unsubscribe();
    detach();
  };
}

export function currentNutritionAccountId() { return activeNutritionAccountId(); }

export function isNutritionDeviceSyncEnabled() { return isLegalCategoryAllowed("sync_cloud"); }

export async function addNutritionItem(
  item: Omit<NutritionItem, "id" | "qty"> & { qty?: number },
  operationId?: string,
  source: PersistedNutritionSource = "manual",
): Promise<boolean> {
  const expectedUserId = activeNutritionAccountId();
  if (!expectedUserId) throw new Error("Espace utilisateur indisponible.");
  const now = Date.now();
  // Tool-call IDs are only unique inside their originating account/session.
  const operationKey = operationId ? `${expectedUserId}:${operationId}` : null;
  if (operationKey) {
    const previous = completedOperations.get(operationKey);
    if (previous && now - previous < 60_000) return false;
    // Reserve the operation before awaiting I/O so two concurrent deliveries
    // carrying the same operation ID cannot create duplicate rows.
    completedOperations.set(operationKey, now);
    for (const [id, timestamp] of completedOperations) if (now - timestamp >= 60_000) completedOperations.delete(id);
  }

  const id = newNutritionUuid();
  const logDate = todayKey();
  const savePendingLocally = () => {
    const saved: NutritionItem = {
      ...item,
      id,
      qty: item.qty ?? 1,
      pendingFoodLog: true,
      pendingFoodLogSource: source,
    };
    const day = logDate;
    const current = readNutritionItems();
    const list = current[day] ?? [];
    if (!list.some((row) => row.id === id)) {
      writeDomain(DOMAIN_ITEMS, { ...current, [day]: [...list, saved] });
    }
    if (!readNutritionItems()[day]?.some((row) => row.id === id)) {
      throw new Error("Impossible de conserver le repas dans le stockage local de cet appareil.");
    }
    return saved;
  };

  try {
    // Always commit the meal to this account's local snapshot before network
    // work. If the session changes or the request is ambiguous, the originating
    // account retains the exact UUID and can retry it when it becomes active.
    savePendingLocally();

    if (!isLegalCategoryAllowed("sync_cloud")) {
      return true;
    }

    // The local bridge and this direct request may overlap. Both use the same
    // UUID and upsert contract, so either ordering remains idempotent.
    let saved: NutritionItem;
    try {
      saved = await persistNutritionItem(item, source, expectedUserId, id, logDate);
    } catch (error) {
      if (activeNutritionAccountId() !== expectedUserId) return true;
      console.warn("[nutrition] canonical insert deferred to local outbox", error instanceof Error ? error.message : error);
      if (isLegalCategoryAllowed("sync_cloud")) {
        try {
          await refreshNutritionFromFoodLog(logDate, { expectedUserId });
        } catch {
          // The stable local UUID stays pending and is retried on reconnect.
        }
      }
      return true;
    }
    if (operationKey) {
      completedOperations.set(operationKey, now);
      for (const [id, timestamp] of completedOperations) if (now - timestamp >= 60_000) completedOperations.delete(id);
    }
    if (activeNutritionAccountId() !== expectedUserId) return true;
    try {
      await refreshNutritionFromFoodLog(logDate, { expectedUserId });
    } catch (refreshError) {
      if (activeNutritionAccountId() !== expectedUserId) return true;
      // The SQL insert already succeeded. Keep the returned row visible rather
      // than telling the user to retry and accidentally inserting it again.
      console.error("[nutrition] canonical refresh failed after successful insert", refreshError instanceof Error ? refreshError.message : refreshError);
      const day = logDate;
      if (activeNutritionAccountId() !== expectedUserId) return true;
      const current = readNutritionItems();
      const list = current[day] ?? [];
      const nextList = list.some((row) => row.id === saved.id)
        ? list.map((row) => row.id === saved.id ? saved : row)
        : [...list, saved];
      writeDomain(DOMAIN_ITEMS, { ...current, [day]: nextList });
    }
    return true;
  } catch (error) {
    if (operationKey) completedOperations.delete(operationKey);
    throw error;
  }
}
