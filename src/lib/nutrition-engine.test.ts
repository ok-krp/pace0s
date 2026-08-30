import { describe, expect, it } from "vitest";
import { calculateNutrition } from "./nutrition-engine";

const rice = { id: "rice", name: "Riz blanc cuit", kcal_per_100g: 130, protein_g_per_100g: 2.7, carbs_g_per_100g: 28.2, fat_g_per_100g: 0.3, fiber_g_per_100g: 0.4, sugar_g_per_100g: 0.1, sodium_mg_per_100g: 1, confidence: 0.95, source: "USDA", version: "1" };

describe("nutrition engine", () => {
  it("scales reference values deterministically by grams", () => {
    expect(calculateNutrition(rice, 200)).toMatchObject({ kcal: 260, protein_g: 5.4, carbs_g: 56.4, fat_g: 0.6 });
  });
  it("never produces negative values", () => {
    expect(calculateNutrition(rice, -50)).toMatchObject({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
});
