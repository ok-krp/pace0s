import { todayKey, applyRemoteWrite } from "@/lib/storage";
import { readDomain, writeDomain } from "@/lib/domain-store";
import { supabase } from "@/integrations/supabase/client";
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
  if (Object.keys(record.value).length > 0) return record.value;
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
  writeDomain(DOMAIN_ITEMS, items);
  writeDomain(DOMAIN_TOTALS, recomputeNutritionTotals(items));
  // Keep the legacy keys during the migration for old screens and recovery.
  try {
    localStorage.setItem(KEY_ITEMS, JSON.stringify(items));
    localStorage.setItem(KEY_TOTALS, JSON.stringify(recomputeNutritionTotals(items)));
  } catch {
    // Keep the domain-backed data usable when legacy localStorage is full.
  }
}

repairNutritionTotals();

function appendLocalNutritionItem(it: NutritionItem): void {
  const today = todayKey();
  const items = readNutritionItems();
  const nextItems = {
    ...items,
    [today]: [...(items[today] ?? []).filter((existing) => existing.id !== it.id), it],
  };
  const totals = recomputeNutritionTotals(nextItems);
  writeDomain(DOMAIN_ITEMS, nextItems);
  writeDomain(DOMAIN_TOTALS, totals);
  try {
    localStorage.setItem(KEY_ITEMS, JSON.stringify(nextItems));
    localStorage.setItem(KEY_TOTALS, JSON.stringify(totals));
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

/**
 * Persist an authenticated Nutrition item in food_log so Web, Flutter and
 * AI/MCP readers share one canonical row. If the SQL request fails while the
 * initiating account is still active, keep the same stable ID in the legacy
 * local outbox path; a later canonical pull will deduplicate that ID.
 */
export async function addNutritionItemToLog(
  item: Omit<NutritionItem, "id" | "qty"> & { qty?: number },
  source: NutritionLogSource,
): Promise<NutritionLogWriteResult> {
  const today = todayKey();
  const it: NutritionItem = { id: crypto.randomUUID(), qty: item.qty ?? 1, ...item };
  const { data: initialSession, error: initialSessionError } = await supabase.auth.getSession();
  if (initialSessionError) throw new Error("Impossible de vérifier la session Nutrition.");
  const userId = initialSession.session?.user.id ?? null;

  if (!userId) {
    appendLocalNutritionItem(it);
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
    meta: {
      client: "pace_web",
      sat_fat_g: it.sat ?? null,
      salt_g: it.salt ?? null,
      iron_mg: it.iron ?? null,
      calcium_mg: it.calcium ?? null,
      vitamin_c_mg: it.vitC ?? null,
    },
  };

  const { error: insertError } = await supabase.from("food_log").insert(payload);
  const { data: currentSession, error: currentSessionError } = await supabase.auth.getSession();
  const stillSameAccount = !currentSessionError &&
    currentSession.session?.user.id === userId &&
    hasCurrentOwner();

  if (insertError) {
    if (stillSameAccount) appendLocalNutritionItem(it);
    else throw new Error("L'enregistrement a échoué après un changement de session. Réessaie après reconnexion.");
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
