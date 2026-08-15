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
  } catch {}
}

repairNutritionTotals();

export function addNutritionItem(item: Omit<NutritionItem, "id" | "qty"> & { qty?: number }) {
  const today = todayKey();
  const it: NutritionItem = { id: crypto.randomUUID(), qty: 1, ...item };
  const items = readNutritionItems();
  const list: NutritionItem[] = [...(items[today] ?? []), it];
  const nextItems = { ...items, [today]: list };
  const totals = recomputeNutritionTotals(nextItems);

  writeDomain(DOMAIN_ITEMS, nextItems);
  writeDomain(DOMAIN_TOTALS, totals);
  try {
    localStorage.setItem(KEY_ITEMS, JSON.stringify(nextItems));
    localStorage.setItem(KEY_TOTALS, JSON.stringify(totals));
  } catch {}
  window.dispatchEvent(new Event("pace.nutrition.changed"));
}
