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

const KEY_ITEMS = "lt.nutrition.items";
const KEY_TOTALS = "lt.nutrition.totals";

export function addNutritionItem(item: Omit<NutritionItem, "id" | "qty"> & { qty?: number }) {
  const today = todayKey();
  const it: NutritionItem = { id: crypto.randomUUID(), qty: 1, ...item };
  const itemsRaw = localStorage.getItem(KEY_ITEMS);
  const items = itemsRaw ? JSON.parse(itemsRaw) : {};
  const list: NutritionItem[] = [...(items[today] ?? []), it];
  items[today] = list;
  localStorage.setItem(KEY_ITEMS, JSON.stringify(items));
  const totals = list.reduce(
    (a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }),
    { kcal: 0, p: 0, c: 0, f: 0 }
  );
  const totalsRaw = localStorage.getItem(KEY_TOTALS);
  const t = totalsRaw ? JSON.parse(totalsRaw) : {};
  t[today] = totals;
  localStorage.setItem(KEY_TOTALS, JSON.stringify(t));
  // notify same-tab listeners
  window.dispatchEvent(new Event("lt.nutrition.changed"));
}
