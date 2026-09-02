import { todayKey } from "@/lib/storage";
import { readDomain, writeDomain } from "@/lib/domain-store";

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
  return readDomain<NutritionMap>(DOMAIN_ITEMS, {}).value;
}

/** Rebuild derived totals and repair an already-corrupted local nutrition state. */
export function repairNutritionTotals(): void {
  if (typeof window === "undefined") return;
  const items = readNutritionItems();
  if (!Object.keys(items).length) return;
  writeDomain(DOMAIN_ITEMS, items);
}

repairNutritionTotals();

export function addNutritionItem(item: Omit<NutritionItem, "id" | "qty"> & { qty?: number }, operationId?: string): boolean {
  if (operationId) {
    const previous = completedOperations.get(operationId);
    if (previous && Date.now() - previous < 60_000) return false;
    completedOperations.set(operationId, Date.now());
    for (const [id, timestamp] of completedOperations) if (Date.now() - timestamp >= 60_000) completedOperations.delete(id);
  }

  const today = todayKey();
  const it: NutritionItem = { id: crypto.randomUUID(), qty: item.qty ?? 1, ...item };
  const items = readNutritionItems();
  const list = [...(items[today] ?? []), it];
  const nextItems = { ...items, [today]: list };

  // writeDomain is the canonical write. It also derives nutrition.totals and
  // emits a timestamped sync mutation so Cloud Sync cannot replay the write.
  writeDomain(DOMAIN_ITEMS, nextItems);
  window.dispatchEvent(new Event("pace.nutrition.changed"));
  return true;
}
