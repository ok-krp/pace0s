import { todayKey, onLocalWrite } from "@/lib/storage";
import { writeDomain, readDomain } from "@/lib/domain-store";
import { supabase } from "@/integrations/supabase/client";
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
};

const DOMAIN_ITEMS = "nutrition.items";
type NutritionTotals = Record<string, { kcal: number; p: number; c: number; f: number }>;
type NutritionMap = Record<string, NutritionItem[]>;
const completedOperations = new Map<string, number>();

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

export async function persistNutritionItem(item: Omit<NutritionItem, "id" | "qty"> & { qty?: number }, source: PersistedNutritionSource = "manual"): Promise<NutritionItem> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Session utilisateur indisponible.");
  const meta = { client_nutrients: { sat: item.sat ?? null, salt: item.salt ?? null, iron: item.iron ?? null, calcium: item.calcium ?? null, vitC: item.vitC ?? null } };
  const { data, error } = await supabase.from("food_log").insert({ user_id: user.id, log_date: todayKey(), meal: item.meal, name: item.name, kcal: item.kcal, protein_g: item.p, carbs_g: item.c, fat_g: item.f, fiber_g: item.fiber ?? 0, sugar_g: item.sugar ?? 0, sodium_mg: item.sodium ?? 0, source, meta }).select("id,name,meal,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg").single();
  if (error || !data) throw new Error(error?.message ?? "Enregistrement nutritionnel impossible.");
  return { id: data.id, name: data.name, meal: data.meal, kcal: Number(data.kcal ?? 0), p: Number(data.protein_g ?? 0), c: Number(data.carbs_g ?? 0), f: Number(data.fat_g ?? 0), fiber: Number(data.fiber_g ?? 0), sugar: Number(data.sugar_g ?? 0), sodium: Number(data.sodium_mg ?? 0), sat: item.sat, salt: item.salt, iron: item.iron, calcium: item.calcium, vitC: item.vitC, qty: item.qty ?? 1 };
}

export async function deletePersistedNutritionItem(id: string): Promise<void> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Session utilisateur indisponible.");
  const { error } = await supabase.from("food_log").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
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
let nutritionBridgeRunning = false;

async function bridgeLocalNutritionToFoodLog(value: unknown) {
  if (nutritionBridgeRunning || typeof window === "undefined") return;
  nutritionBridgeRunning = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const nextRows = nutritionRows(value);
    const previousById = new Map(nutritionRows(lastBridgedNutrition).map((row) => [row.id, row.item]));
    // Query only IDs present in this snapshot. A missing ID is not a delete
    // instruction: snapshots can be partial, stale, or still hydrating.
    const requestedIds = [...new Set(nextRows.map((row) => row.id))];
    const { data: existing, error: selectError } = requestedIds.length
      ? await supabase.from("food_log").select("id").eq("user_id", user.id).in("id", requestedIds)
      : { data: [], error: null };
    if (selectError) throw selectError;
    const existingIds = new Set((existing ?? []).map((row) => row.id));
    for (const { id, day, item } of nextRows) {
      const previous = previousById.get(id);
      const changed = previous !== undefined && JSON.stringify(previous) !== JSON.stringify(item);
      if (existingIds.has(id) && !changed) continue;
      const payload = { id, user_id: user.id, log_date: day, meal: item.meal, name: item.name, kcal: Number(item.kcal || 0), protein_g: Number(item.p || 0), carbs_g: Number(item.c || 0), fat_g: Number(item.f || 0), fiber_g: Number(item.fiber || 0), sugar_g: Number(item.sugar || 0), sodium_mg: Number(item.sodium || 0), source: existingIds.has(id) ? undefined : "manual", meta: { client_nutrients: { sat: item.sat ?? null, salt: item.salt ?? null, iron: item.iron ?? null, calcium: item.calcium ?? null, vitC: item.vitC ?? null } } };
      if (existingIds.has(id)) {
        const { source: _source, ...update } = payload;
        const { error } = await supabase.from("food_log").update(update).eq("id", id).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("food_log").insert(payload);
        if (error) throw error;
        existingIds.add(id);
      }
    }
    // Deliberately no DELETE here. Only an explicit delete action may remove
    // a food_log row; absence from a local snapshot must never erase cloud data.
    lastBridgedNutrition = value && typeof value === "object" && !Array.isArray(value) ? value as NutritionMap : {};
  } catch (error) {
    console.error("[nutrition] food_log bridge failed", error instanceof Error ? error.message : error);
  } finally {
    nutritionBridgeRunning = false;
  }
}

if (typeof window !== "undefined") {
  onLocalWrite((key, value) => {
    if (key !== "pace.nutrition.items") return;
    void bridgeLocalNutritionToFoodLog(value);
  });
  void bridgeLocalNutritionToFoodLog(lastBridgedNutrition);
}

async function refreshNutritionFromFoodLog(day: string) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Session utilisateur indisponible.");
  // Recover entries created by older app versions that existed only in the
  // device's local domain snapshot. Keep their original IDs and never delete.
  const localSnapshot = readNutritionItems();
  const localRows = localSnapshot[day] ?? [];
  const localIds = [...new Set(localRows.map((item) => item.id).filter(Boolean))];
  if (localIds.length) {
    const { data: existing, error: lookupError } = await supabase.from("food_log")
      .select("id").eq("user_id", user.id).in("id", localIds);
    if (lookupError) throw new Error(lookupError.message);
    const existingIds = new Set((existing ?? []).map((row) => row.id));
    for (const item of localRows) {
      if (existingIds.has(item.id)) continue;
      const { error: insertError } = await supabase.from("food_log").insert({
        id: item.id, user_id: user.id, log_date: day, meal: item.meal, name: item.name,
        kcal: Number(item.kcal || 0), protein_g: Number(item.p || 0),
        carbs_g: Number(item.c || 0), fat_g: Number(item.f || 0),
        fiber_g: Number(item.fiber || 0), sugar_g: Number(item.sugar || 0),
        sodium_mg: Number(item.sodium || 0), source: "manual",
        meta: { client_nutrients: { sat: item.sat ?? null, salt: item.salt ?? null, iron: item.iron ?? null, calcium: item.calcium ?? null, vitC: item.vitC ?? null } },
      });
      if (insertError) throw new Error(insertError.message);
    }
  }
  const { data, error } = await supabase.from("food_log")
    .select("id,name,meal,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg,meta")
    .eq("user_id", user.id).eq("log_date", day).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows: NutritionItem[] = (data ?? []).map((row) => {
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
  writeDomain(DOMAIN_ITEMS, { ...current, [day]: rows });
  window.dispatchEvent(new Event("pace.nutrition.changed"));
}

export function isNutritionDeviceSyncEnabled() { return isLegalCategoryAllowed("sync_cloud"); }

export async function addNutritionItem(
  item: Omit<NutritionItem, "id" | "qty"> & { qty?: number },
  operationId?: string,
  source: PersistedNutritionSource = "manual",
): Promise<boolean> {
  const now = Date.now();
  if (operationId) {
    const previous = completedOperations.get(operationId);
    if (previous && now - previous < 60_000) return false;
    // Reserve the operation before awaiting I/O so two concurrent deliveries
    // carrying the same operation ID cannot create duplicate rows.
    completedOperations.set(operationId, now);
    for (const [id, timestamp] of completedOperations) if (now - timestamp >= 60_000) completedOperations.delete(id);
  }

  // food_log is canonical: persist before projecting the entry into local UI
  // state, then rebuild the day's complete view from the database.
  try {
    await persistNutritionItem(item, source);
    await refreshNutritionFromFoodLog(todayKey());
    return true;
  } catch (error) {
    if (operationId) completedOperations.delete(operationId);
    throw error;
  }
}
