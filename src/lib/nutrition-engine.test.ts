import { calculateNutrition } from "./nutrition-engine";

const rice = { id: "rice", name: "Riz blanc cuit", kcal_per_100g: 130, protein_g_per_100g: 2.7, carbs_g_per_100g: 28.2, fat_g_per_100g: 0.3, fiber_g_per_100g: 0.4, sugar_g_per_100g: 0.1, sodium_mg_per_100g: 1, confidence: 0.95, source: "USDA", version: "1" };
const result = calculateNutrition(rice, 200);
if (result.kcal !== 260 || result.protein_g !== 5.4 || result.carbs_g !== 56.4 || result.fat_g !== 0.6) {
  throw new Error(`Nutrition scaling failed: ${JSON.stringify(result)}`);
}
const zero = calculateNutrition(rice, -50);
if (zero.kcal !== 0 || zero.protein_g !== 0 || zero.carbs_g !== 0 || zero.fat_g !== 0) {
  throw new Error(`Negative grams guard failed: ${JSON.stringify(zero)}`);
}
