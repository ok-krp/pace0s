import { todayKey, onLocalWrite } from "@/lib/storage";
import { writeDomain, readDomain } from "@/lib/domain-store";
import { supabase } from "@/integrations/supabase/client";

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
const recentAdds = new Map<string, number>();

function addFingerprint(item: Omit<NutritionItem, "id" | "qty"> & { qty?: number }) {
  return JSON.stringify({ name: item.name.trim(), meal: item.meal.trim(), kcal: Number(item.kcal || 0), p: Number(item.p || 0), c: Number(item.c || 0), f: Number(item.f || 0), fiber: Number(item.fiber || 0), sugar: Number(item.sugar || 0), sodium: Number(item.sodium || 0), qty: Number(item.qty ?? 1) });
}

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
    const previousRows = nutritionRows(lastBridgedNutrition);
    const previousIds = new Set(previousRows.map((row) => row.id));
    const nextIds = new Set(nextRows.map((row) => row.id));
    const { data: existing, error: selectError } = await supabase.from("food_log").select("id").eq("user_id", user.id);
    if (selectError) throw selectError;
    const existingIds = new Set((existing ?? []).map((row) => row.id));
    for (const { id, day, item } of nextRows) {
      const payload = { id, user_id: user.id, log_date: day, meal: item.meal, name: item.name, kcal: Number(item.kcal || 0), protein_g: Number(item.p || 0), carbs_g: Number(item.c || 0), fat_g: Number(item.f || 0), fiber_g: Number(item.fiber || 0), sugar_g: Number(item.sugar || 0), sodium_mg: Number(item.sodium || 0), source: existingIds.has(id) ? undefined : "manual", meta: { client_nutrients: { sat: item.sat ?? null, salt: item.salt ?? null, iron: item.iron ?? null, calcium: item.calcium ?? null, vitC: item.vitC ?? null } } };
      if (existingIds.has(id)) {
        const { source: _source, ...update } = payload;
        const { error } = await supabase.from("food_log").update(update).eq("id", id).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("food_log").insert(payload);
        if (error) throw error;
      }
    }
    for (const id of previousIds) {
      if (nextIds.has(id)) continue;
      const { error } = await supabase.from("food_log").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw error;
    }
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

export function addNutritionItem(item: Omit<NutritionItem, "id" | "qty"> & { qty?: number }, operationId?: string): boolean {
  const now = Date.now();
  if (operationId) {
    const previous = completedOperations.get(operationId);
    if (previous && now - previous < 60_000) return false;
    completedOperations.set(operationId, now);
    for (const [id, timestamp] of completedOperations) if (now - timestamp >= 60_000) completedOperations.delete(id);
  } else {
    const fingerprint = addFingerprint(item);
    const previous = recentAdds.get(fingerprint);
    if (previous && now - previous < 2_000) return false;
    recentAdds.set(fingerprint, now);
    for (const [key, timestamp] of recentAdds) if (now - timestamp >= 2_000) recentAdds.delete(key);
  }
  const today = todayKey();
  const it: NutritionItem = { id: crypto.randomUUID(), qty: item.qty ?? 1, ...item };
  const items = readNutritionItems();
  const list = [...(items[today] ?? []), it];
  const nextItems = { ...items, [today]: list };
  writeDomain(DOMAIN_ITEMS, nextItems);
  window.dispatchEvent(new Event("pace.nutrition.changed"));
  return true;
}
