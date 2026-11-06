import { todayKey, applyRemoteWrite } from "@/lib/storage";
import { applyRemoteDomainWrite, readDomain, writeDomain } from "@/lib/domain-store";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import {
  nutritionFoodLogOutboxKey,
  isValidNutritionItemInput,
  queueFoodLogInsert,
  deferFoodLogOutboxInsert,
  readValidFoodLogOutbox,
  removeFoodLogOutboxInsert,
  type FoodLogInsertRow,
} from "@/lib/nutrition-food-log-outbox";
import {
  mergeNutritionTombstoneMaps,
  mergeUnassignedNutritionSnapshots,
  NUTRITION_CACHE_OWNER_KEY,
  NUTRITION_LEGACY_TOMBSTONES_KEY,
  NUTRITION_UNASSIGNED_BACKUP_KEY,
  nutritionAccountCacheKeys,
} from "@/lib/nutrition-sync";

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
};

const KEY_ITEMS = "pace.nutrition.items";
const KEY_TOTALS = "pace.nutrition.totals";
const DOMAIN_ITEMS = "nutrition.items";
const DOMAIN_TOTALS = "nutrition.totals";

type NutritionTotals = Record<string, { kcal: number; p: number; c: number; f: number }>;
type NutritionMap = Record<string, NutritionItem[]>;

export function recomputeNutritionTotals(items: NutritionMap): NutritionTotals {
  const totals: NutritionTotals = {};
  for (const [day, list] of Object.entries(items)) {
    totals[day] = list.reduce((a, x) => ({
      kcal: a.kcal + Number(x.kcal || 0),
      p: a.p + Number(x.p || 0),
      c: a.c + Number(x.c || 0),
      f: a.f + Number(x.f || 0),
    }), { kcal: 0, p: 0, c: 0, f: 0 });
  }
  return totals;
}

function readNutritionItems(): NutritionMap {
  const record = readDomain<NutritionMap>(DOMAIN_ITEMS, {});
  // An explicitly stored empty domain is authoritative (not a cache miss).
  // Falling back to the legacy key in that case can resurrect another
  // account's Nutrition snapshot after logout cleanup.
  if (record.mutationId !== "empty" && record.mutationId !== "server") {
    return record.value;
  }
  try {
    const raw = localStorage.getItem(KEY_ITEMS);
    return raw ? JSON.parse(raw) as NutritionMap : {};
  } catch { return {}; }
}

/** Repair derived totals without changing the source nutrition items. */
export function repairNutritionTotals(): void {
  if (typeof window === "undefined") return;
  const items = readNutritionItems();
  if (!Object.keys(items).length) return;
  const totals = recomputeNutritionTotals(items);
  // Totals are derived state. Repairing them must not re-emit the entire
  // Nutrition item JSON as a cloud mutation or inflate user_state egress.
  applyRemoteDomainWrite(DOMAIN_TOTALS, totals);
  try {
    localStorage.setItem(KEY_TOTALS, JSON.stringify(totals));
  } catch {
    // The account-local domain cache remains usable when the legacy key is full.
  }
}

/**
 * A Recipes/scan entry point can remain mounted while the auth session changes,
 * even when NutritionLogView itself is unmounted. Preserve the outgoing
 * account's last live snapshot and clear its compatibility mirror before a
 * guest write is allowed to read the shared domain keys.
 */
function isolatePreviousAccountForGuest(): void {
  if (typeof window === "undefined") return;
  const owner = localStorage.getItem(NUTRITION_CACHE_OWNER_KEY);
  if (!owner) return;

  const scopedKeys = nutritionAccountCacheKeys(owner);
  const currentItems = readNutritionItems();
  const currentTotals = recomputeNutritionTotals(currentItems);
  const globalTombstones = localStorage.getItem(NUTRITION_LEGACY_TOMBSTONES_KEY);

  // Do not clear the owner marker unless all recovery copies are durable.
  localStorage.setItem(scopedKeys.items, JSON.stringify(currentItems));
  localStorage.setItem(scopedKeys.totals, JSON.stringify(currentTotals));
  if (globalTombstones) {
    localStorage.setItem(
      scopedKeys.deletedIds,
      JSON.stringify(mergeNutritionTombstoneMaps(
        localStorage.getItem(scopedKeys.deletedIds),
        globalTombstones,
      )),
    );
  }
  // Domain writes are deliberately remote-shaped, not local mutations: a
  // logout cleanup must not enqueue the previous account's empty snapshot.
  applyRemoteDomainWrite(DOMAIN_ITEMS, {});
  applyRemoteDomainWrite(DOMAIN_TOTALS, {});
  if (Object.keys(readNutritionItems()).length > 0) {
    throw new Error("Le cache Nutrition précédent n'a pas pu être isolé.");
  }
  applyRemoteWrite(NUTRITION_LEGACY_TOMBSTONES_KEY, {});
  // Remove ownership only after both account-local copies and the cleared
  // compatibility/domain views are durable and verified.
  localStorage.removeItem(NUTRITION_CACHE_OWNER_KEY);
}

function appendLocalNutritionItem(
  it: NutritionItem,
  accountUserId?: string,
  syncDomain = true,
): void {
  const today = todayKey();
  const items = readNutritionItems();
  const nextItems = {
    ...items,
    [today]: [...(items[today] ?? []).filter((existing) => existing.id !== it.id), it],
  };
  const totals = recomputeNutritionTotals(nextItems);
  if (syncDomain) {
    writeDomain(DOMAIN_ITEMS, nextItems);
    writeDomain(DOMAIN_TOTALS, totals);
  } else {
    // Guest and account-local fallback writes must not be pushed as a large
    // user_state nutrition JSON snapshot.
    applyRemoteDomainWrite(DOMAIN_ITEMS, nextItems);
    applyRemoteDomainWrite(DOMAIN_TOTALS, totals);
  }
  try {
    localStorage.setItem(KEY_ITEMS, JSON.stringify(nextItems));
    localStorage.setItem(KEY_TOTALS, JSON.stringify(totals));
    // A SQL failure must still leave a usable local fallback even when cloud
    // sync is disabled by consent. Never mirror it into a different owner.
    if (
      accountUserId &&
      localStorage.getItem(NUTRITION_CACHE_OWNER_KEY) === accountUserId
    ) {
      const accountKeys = nutritionAccountCacheKeys(accountUserId);
      localStorage.setItem(accountKeys.items, JSON.stringify(nextItems));
      localStorage.setItem(accountKeys.totals, JSON.stringify(totals));
    }
  } catch {
    // Keep the domain-backed data usable when legacy localStorage is full.
  }
  window.dispatchEvent(new Event("pace.nutrition.changed"));
}

export function addNutritionItem(item: Omit<NutritionItem, "id" | "qty"> & { qty?: number }) {
  appendLocalNutritionItem({ id: crypto.randomUUID(), qty: item.qty ?? 1, ...item });
}

export type NutritionLogSource = "manual" | "barcode" | "photo" | "recipe";
export type NutritionLogWriteResult = "cloud" | "local" | "saved-for-previous-account";
export type NutritionLogWriteOptions = {
  healthScore?: "green" | "orange" | "red";
  meta?: Record<string, unknown>;
};

/**
 * Retry account-local food_log inserts after a network failure. The queue is
 * deliberately stored under pace.__sync_* so it can never become a user_state
 * payload. Upserts are idempotent by the stable row UUID.
 */
export async function flushNutritionFoodLogOutbox(
  expectedUserId: string,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  if (!expectedUserId.trim() || isCancelled()) return;
  try {
    const { data: initial, error: initialError } = await supabase.auth.getSession();
    if (initialError || initial.session?.user.id !== expectedUserId) return;
    const key = nutritionFoodLogOutboxKey(expectedUserId);
    const raw = localStorage.getItem(key);
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep malformed persisted bytes untouched for manual recovery.
      return;
    }
    const pending = readValidFoodLogOutbox(parsed, expectedUserId);
    for (const operation of pending) {
      if (isCancelled()) return;
      const { data: before, error: beforeError } = await supabase.auth.getSession();
      if (beforeError || before.session?.user.id !== expectedUserId) return;

      let writeError: unknown = null;
      try {
        const { error } = await supabase
          .from("food_log")
          .upsert(
            operation.row as unknown as TablesInsert<"food_log">,
            { onConflict: "id", ignoreDuplicates: true },
          );
        writeError = error;
      } catch (error) {
        // Fetch/client transport failures can reject instead of returning a
        // PostgREST { error }. Treat them as retryable writes and back off.
        writeError = error;
      }
      const { data: after, error: afterError } = await supabase.auth.getSession();
      if (isCancelled() || afterError || after.session?.user.id !== expectedUserId) return;
      if (writeError) {
        let current: unknown;
        try {
          current = JSON.parse(localStorage.getItem(key) ?? "[]");
        } catch {
          // Preserve unreadable pending data exactly as found on disk.
          continue;
        }
        const deferred = deferFoodLogOutboxInsert(current, operation, Date.now());
        try {
          localStorage.setItem(key, JSON.stringify(deferred));
        } catch {
          // Keep the current on-disk operation; retry after storage recovers.
        }
        continue;
      }

      // Remove only the exact queued version acknowledged by this request.
      // A user edit that replaced this UUID in flight remains queued.
      let current: unknown;
      try {
        current = JSON.parse(localStorage.getItem(key) ?? "[]");
      } catch {
        return;
      }
      const remaining = removeFoodLogOutboxInsert(current, operation);
      try {
        localStorage.setItem(key, JSON.stringify(remaining));
      } catch {
        // The upsert is idempotent; a later retry can safely acknowledge it.
        return;
      }
    }
  } catch {
    // Offline, expired session, and transient PostgREST failures are retried
    // by the next online event or bounded sync tick.
  }
}

/**
 * Persist an authenticated Nutrition item in food_log so Web, Flutter and
 * AI/MCP readers share one canonical row. If the SQL request fails while the
 * initiating account is still active, keep the same stable ID in the legacy
 * local outbox path; a later canonical pull will deduplicate that ID.
 */
export async function addNutritionItemToLog(
  item: Omit<NutritionItem, "id" | "qty"> & { qty?: number },
  source: NutritionLogSource,
  missingNutrients: readonly string[] = [],
  options: NutritionLogWriteOptions = {},
): Promise<NutritionLogWriteResult> {
  const today = todayKey();
  const it: NutritionItem = { id: crypto.randomUUID(), qty: item.qty ?? 1, ...item };
  if (!isValidNutritionItemInput(it)) {
    throw new RangeError("Les valeurs Nutrition doivent être finies, positives ou nulles, avec un nom et un repas.");
  }
  const { data: initialSession, error: initialSessionError } = await supabase.auth.getSession();
  if (initialSessionError) throw new Error("Impossible de vérifier la session Nutrition.");
  const userId = initialSession.session?.user.id ?? null;

  if (!userId) {
    try {
      isolatePreviousAccountForGuest();
    } catch {
      // Failing to isolate a previous account is not permission to reuse its
      // shared cache as guest state.
      throw new Error("Impossible d'isoler le cache Nutrition du compte précédent.");
    }
    appendLocalNutritionItem(it, undefined, false);
    return "local";
  }

  const accountKeys = nutritionAccountCacheKeys(userId);
  const cacheOwner = localStorage.getItem(NUTRITION_CACHE_OWNER_KEY);
  const globalItems = localStorage.getItem(KEY_ITEMS);
  const globalTotals = localStorage.getItem(KEY_TOTALS);
  const globalTombstones = localStorage.getItem(NUTRITION_LEGACY_TOMBSTONES_KEY);

  // Preserve the outgoing account before hydrating another account's private
  // cache. Unowned legacy/guest data is backed up, never assigned to a login.
  if (cacheOwner && cacheOwner !== userId) {
    const previousKeys = nutritionAccountCacheKeys(cacheOwner);
    try {
      if (globalItems && !localStorage.getItem(previousKeys.items)) {
        localStorage.setItem(previousKeys.items, globalItems);
      }
      if (globalTotals && !localStorage.getItem(previousKeys.totals)) {
        localStorage.setItem(previousKeys.totals, globalTotals);
      }
      if (globalTombstones) {
        localStorage.setItem(
          previousKeys.deletedIds,
          JSON.stringify(mergeNutritionTombstoneMaps(
            localStorage.getItem(previousKeys.deletedIds),
            globalTombstones,
          )),
        );
      }
    } catch {
      // The current user's independent scope remains authoritative below.
    }
  } else if (!cacheOwner && globalItems) {
    const guestBackup = mergeUnassignedNutritionSnapshots(
      localStorage.getItem(NUTRITION_UNASSIGNED_BACKUP_KEY),
      globalItems,
    );
    try {
      if (guestBackup) {
        localStorage.setItem(NUTRITION_UNASSIGNED_BACKUP_KEY, JSON.stringify(guestBackup));
        localStorage.setItem(
          `${NUTRITION_UNASSIGNED_BACKUP_KEY}:totals`,
          JSON.stringify(recomputeNutritionTotals(guestBackup)),
        );
      } else if (!localStorage.getItem(NUTRITION_UNASSIGNED_BACKUP_KEY)) {
        localStorage.setItem(NUTRITION_UNASSIGNED_BACKUP_KEY, globalItems);
        if (globalTotals) {
          localStorage.setItem(`${NUTRITION_UNASSIGNED_BACKUP_KEY}:totals`, globalTotals);
        }
      }
      if (globalTombstones) {
        localStorage.setItem(
          `${NUTRITION_UNASSIGNED_BACKUP_KEY}:deleted_ids`,
          JSON.stringify(mergeNutritionTombstoneMaps(
            localStorage.getItem(`${NUTRITION_UNASSIGNED_BACKUP_KEY}:deleted_ids`),
            globalTombstones,
          )),
        );
      }
    } catch {
      // Preserve existing recovery material if browser storage is constrained.
    }
  }

  let scopedItems: NutritionMap = {};
  let scopedTotals: NutritionTotals = {};
  try {
    const scopedRaw = localStorage.getItem(accountKeys.items);
    const fallbackRaw = cacheOwner === userId ? globalItems : null;
    const parsed: unknown = scopedRaw
      ? JSON.parse(scopedRaw)
      : fallbackRaw ? JSON.parse(fallbackRaw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      scopedItems = parsed as NutritionMap;
    }
  } catch {
    // Do not import malformed data from another account or replace its backup.
  }
  try {
    const scopedRaw = localStorage.getItem(accountKeys.totals);
    const fallbackRaw = cacheOwner === userId ? globalTotals : null;
    const parsed: unknown = scopedRaw
      ? JSON.parse(scopedRaw)
      : fallbackRaw ? JSON.parse(fallbackRaw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      scopedTotals = parsed as NutritionTotals;
    }
  } catch {
    scopedTotals = recomputeNutritionTotals(scopedItems);
  }

  const scopedTombstones = mergeNutritionTombstoneMaps(
    localStorage.getItem(accountKeys.deletedIds),
    cacheOwner === userId ? globalTombstones : null,
  );
  localStorage.setItem(NUTRITION_CACHE_OWNER_KEY, userId);
  try {
    localStorage.setItem(accountKeys.items, JSON.stringify(scopedItems));
    localStorage.setItem(accountKeys.totals, JSON.stringify(scopedTotals));
    localStorage.setItem(accountKeys.deletedIds, JSON.stringify(scopedTombstones));
  } catch {
    // Continue with the in-memory/compatibility state; SQL remains canonical.
  }
  applyRemoteWrite(KEY_ITEMS, scopedItems);
  applyRemoteWrite(KEY_TOTALS, scopedTotals);
  applyRemoteWrite(NUTRITION_LEGACY_TOMBSTONES_KEY, scopedTombstones);

  const payload = {
    id: it.id,
    user_id: userId,
    log_date: today,
    meal: it.meal,
    name: it.name,
    kcal: it.kcal,
    protein_g: it.p,
    carbs_g: it.c,
    fat_g: it.f,
    fiber_g: it.fiber ?? 0,
    sugar_g: it.sugar ?? 0,
    sodium_mg: it.sodium ?? 0,
    source,
    ...(options.healthScore ? { health_score: options.healthScore } : {}),
    meta: {
      ...(options.meta ?? {}),
      client: "pace_web",
      sat_fat_g: it.sat ?? null,
      salt_g: it.salt ?? null,
      iron_mg: it.iron ?? null,
      calcium_mg: it.calcium ?? null,
      vitamin_c_mg: it.vitC ?? null,
      missing_nutrients: [...new Set([
        ...missingNutrients,
        ...(it.fiber == null ? ["fiber_g"] : []),
        ...(it.sugar == null ? ["sugar_g"] : []),
        ...(it.sodium == null ? ["sodium_mg"] : []),
      ])],
    },
  };

  const { error: insertError } = await supabase.from("food_log").insert(payload);
  const { data: currentSession, error: currentSessionError } = await supabase.auth.getSession();
  const stillSameAccount = !currentSessionError &&
    currentSession.session?.user.id === userId &&
    localStorage.getItem(NUTRITION_CACHE_OWNER_KEY) === userId;

  if (insertError) {
    const outboxKey = nutritionFoodLogOutboxKey(userId);
    let rawOutbox: unknown;
    try {
      rawOutbox = JSON.parse(localStorage.getItem(outboxKey) ?? "[]");
    } catch {
      // Do not silently replace corrupt pending operations with an empty queue.
      throw new Error("La file Nutrition locale est illisible ; aucune donnée n'a été remplacée.");
    }
    const queued = queueFoodLogInsert(
      rawOutbox,
      payload as FoodLogInsertRow,
      new Date().toISOString(),
    );
    try {
      localStorage.setItem(outboxKey, JSON.stringify(queued));
    } catch {
      throw new Error("Stockage local saturé ; le repas n'a pas pu être mis en attente.");
    }

    if (stillSameAccount) {
      appendLocalNutritionItem(it, userId, false);
    } else {
      // The network request completed after a session switch. Update only the
      // initiating account's isolated cache; never mutate the new account's
      // domain store or compatibility keys.
      const scopedRaw = localStorage.getItem(accountKeys.items);
      let scopedItems: NutritionMap = {};
      try {
        const parsed: unknown = scopedRaw ? JSON.parse(scopedRaw) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          scopedItems = parsed as NutritionMap;
        }
      } catch {
        // Preserve the durable outbox; the next login can rebuild this cache.
      }
      const nextItems = {
        ...scopedItems,
        [today]: [
          ...(scopedItems[today] ?? []).filter((existing) => existing.id !== it.id),
          it,
        ],
      };
      localStorage.setItem(accountKeys.items, JSON.stringify(nextItems));
      localStorage.setItem(accountKeys.totals, JSON.stringify(recomputeNutritionTotals(nextItems)));
    }
    return "local";
  }

  // A successful insert is already durable for the initiating account. If
  // that account switched away during the request, do not touch the new
  // account's compatibility cache; its next login will pull the SQL row.
  if (!stillSameAccount) return "saved-for-previous-account";

  const currentItems = readNutritionItems();
  const nextItems: NutritionMap = {
    ...currentItems,
    [today]: [
      ...(currentItems[today] ?? []).filter((existing) => existing.id !== it.id),
      { ...it, __foodLogCanonical: true } as NutritionItem,
    ],
  };
  const nextTotals = recomputeNutritionTotals(nextItems);
  try {
    localStorage.setItem(accountKeys.items, JSON.stringify(nextItems));
    localStorage.setItem(accountKeys.totals, JSON.stringify(nextTotals));
  } catch {
    // The canonical SQL row is durable; the next refresh can rebuild this cache.
  }
  applyRemoteWrite(KEY_ITEMS, nextItems);
  applyRemoteWrite(KEY_TOTALS, nextTotals);
  window.dispatchEvent(new Event("pace.nutrition.changed"));
  return "cloud";
}
