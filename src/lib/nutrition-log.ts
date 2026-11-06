import { todayKey, applyRemoteWrite } from "@/lib/storage";
import { readDomain, writeDomain } from "@/lib/domain-store";
import { supabase } from "@/integrations/supabase/client";
import { NUTRITION_CACHE_OWNER_KEY, nutritionAccountCacheKeys } from "@/lib/nutrition-sync";

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
  const hasCurrentOwner = () =>
    localStorage.getItem(NUTRITION_CACHE_OWNER_KEY) === userId;
  if (!hasCurrentOwner()) {
    throw new Error("Le cache Nutrition de ce compte n'est pas encore initialisé.");
  }

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
  localStorage.setItem(accountKeys.items, JSON.stringify(nextItems));
  localStorage.setItem(accountKeys.totals, JSON.stringify(nextTotals));
  applyRemoteWrite(KEY_ITEMS, nextItems);
  applyRemoteWrite(KEY_TOTALS, nextTotals);
  window.dispatchEvent(new Event("pace.nutrition.changed"));
  return "cloud";
}
