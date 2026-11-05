import type { NutritionItem } from "./nutrition-log";

export type CanonicalFoodLogRow = {
  id: string;
  log_date: string;
  meal: string;
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  meta: unknown;
};

export type CanonicalNutritionItem = NutritionItem & {
  __foodLogCanonical: true;
};

function missingNutrients(meta: unknown): Set<string> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return new Set();
  const value = (meta as Record<string, unknown>).missing_nutrients;
  return Array.isArray(value)
    ? new Set(value.filter((entry): entry is string => typeof entry === "string"))
    : new Set();
}

export function mapFoodLogRow(row: CanonicalFoodLogRow): CanonicalNutritionItem {
  const missing = missingNutrients(row.meta);
  return {
    id: row.id,
    name: row.name,
    meal: row.meal,
    kcal: missing.has("kcal") ? 0 : Number(row.kcal ?? 0),
    p: missing.has("protein_g") ? 0 : Number(row.protein_g ?? 0),
    c: missing.has("carbs_g") ? 0 : Number(row.carbs_g ?? 0),
    f: missing.has("fat_g") ? 0 : Number(row.fat_g ?? 0),
    fiber: row.fiber_g == null ? undefined : Number(row.fiber_g),
    sugar: row.sugar_g == null ? undefined : Number(row.sugar_g),
    sodium: row.sodium_mg == null ? undefined : Number(row.sodium_mg),
    qty: 1,
    __foodLogCanonical: true,
  };
}

/**
 * SQL food_log rows are authoritative for items previously reconciled from
 * that table. Old JSON-only entries remain visible until they are migrated.
 * A deleted SQL row is removed after its cached item has been marked canonical.
 */
export function mergeCanonicalNutritionItems(
  localItems: readonly NutritionItem[],
  remoteRows: readonly CanonicalFoodLogRow[],
  deletedIds: ReadonlySet<string> = new Set(),
): NutritionItem[] {
  const remoteItems = remoteRows
    .filter((row) => !deletedIds.has(row.id))
    .map(mapFoodLogRow);
  const remoteIds = new Set(remoteItems.map((item) => item.id));
  const legacyItems = localItems.filter((item) => {
    const candidate = item as NutritionItem & { __foodLogCanonical?: unknown };
    return !deletedIds.has(item.id) &&
      !remoteIds.has(item.id) &&
      candidate.__foodLogCanonical !== true;
  });
  return [...remoteItems, ...legacyItems];
}
