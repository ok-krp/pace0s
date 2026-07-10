import { useLocalState } from "@/lib/storage";

export type NutCol = "kcal" | "protein" | "carbs" | "fat" | "sat_fat" | "sugar" | "fiber" | "salt" | "sodium" | "iron" | "calcium" | "vit_c";

export const NUT_COLS: { key: NutCol; label: string; unit: string }[] = [
  { key: "kcal", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protéines", unit: "g" },
  { key: "carbs", label: "Glucides", unit: "g" },
  { key: "fat", label: "Lipides", unit: "g" },
  { key: "sat_fat", label: "Gras saturés", unit: "g" },
  { key: "sugar", label: "Sucres", unit: "g" },
  { key: "fiber", label: "Fibres", unit: "g" },
  { key: "salt", label: "Sel", unit: "g" },
  { key: "sodium", label: "Sodium", unit: "mg" },
  { key: "iron", label: "Fer", unit: "mg" },
  { key: "calcium", label: "Calcium", unit: "mg" },
  { key: "vit_c", label: "Vitamine C", unit: "mg" },
];

export const DEFAULT_NUT_COLS: NutCol[] = ["kcal", "protein", "carbs", "fat"];

export function useNutritionCols() {
  return useLocalState<NutCol[]>("lt.nutrition.columns", DEFAULT_NUT_COLS);
}
