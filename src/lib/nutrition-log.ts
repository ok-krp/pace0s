import { todayKey } from "@/lib/storage";

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

export function recomputeNutritionTotals(items: Record<string, NutritionItem[]>): Record<string, { kcal: number; p: number; c: number; f: number }> {
  const totals: Record<string, { kcal: number; p: number; c: number; f: number }> = {};
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

/** Repair stale derived totals without touching the source nutrition items. */
export function repairNutritionTotals(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY_ITEMS);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const totals = recomputeNutritionTotals(parsed as Record<string, NutritionItem[]>);
    localStorage.setItem(KEY_TOTALS, JSON.stringify(totals));
  } catch {
    // Source items remain untouched if the cache is malformed.
  }
}

repairNutritionTotals();

export function addNutritionItem(item: Omit<NutritionItem, "id" | "qty"> & { qty?: number }) {
  const today = todayKey();
  const it: NutritionItem = { id: crypto.randomUUID(), qty: 1, ...item };
  const itemsRaw = localStorage.getItem(KEY_ITEMS);
  const items = itemsRaw ? JSON.parse(itemsRaw) : {};
  const list: NutritionItem[] = [...(items[today] ?? []), it];
  items[today] = list;
  localStorage.setItem(KEY_ITEMS, JSON.stringify(items));
  localStorage.setItem(KEY_TOTALS, JSON.stringify(recomputeNutritionTotals(items)));
  window.dispatchEvent(new Event("pace.nutrition.changed"));
}
