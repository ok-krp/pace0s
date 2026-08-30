import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type NutritionReference = {
  id: string;
  name: string;
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  fiber_g_per_100g: number;
  sugar_g_per_100g: number;
  sodium_mg_per_100g: number;
  confidence: number;
  source: string;
  version: string;
};

export type NutritionPortion = {
  name: string;
  grams: number;
  reference_id?: string;
};

export type NutritionResult = {
  items: Array<NutritionPortion & { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number; sodium_mg: number; confidence: number }>;
  totals: { grams: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number; sodium_mg: number };
  confidence: number;
  calorie_check: { macro_kcal: number; reported_kcal: number; delta_percent: number; consistent: boolean };
};

const n = (v: number, digits = 1) => Number(v.toFixed(digits));

export async function findNutritionReference(name: string): Promise<NutritionReference | null> {
  const normalized = name.trim();
  if (!normalized) return null;
  const { data, error } = await supabaseAdmin
    .from("nutrition_reference_foods")
    .select("id,name,kcal_per_100g,protein_g_per_100g,carbs_g_per_100g,fat_g_per_100g,fiber_g_per_100g,sugar_g_per_100g,sodium_mg_per_100g,confidence,source,version")
    .ilike("name", `%${normalized}%`)
    .order("confidence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Nutrition reference lookup failed: ${error.message}`);
  return data as NutritionReference | null;
}

export function calculateNutrition(reference: NutritionReference, grams: number) {
  const f = Math.max(0, grams) / 100;
  return {
    kcal: Math.round(Number(reference.kcal_per_100g) * f),
    protein_g: n(Number(reference.protein_g_per_100g) * f),
    carbs_g: n(Number(reference.carbs_g_per_100g) * f),
    fat_g: n(Number(reference.fat_g_per_100g) * f),
    fiber_g: n(Number(reference.fiber_g_per_100g) * f),
    sugar_g: n(Number(reference.sugar_g_per_100g) * f),
    sodium_mg: n(Number(reference.sodium_mg_per_100g) * f),
  };
}

export async function calculateReferenceBasedNutrition(portions: NutritionPortion[]): Promise<NutritionResult> {
  const items = [];
  for (const portion of portions) {
    const ref = portion.reference_id
      ? (await supabaseAdmin.from("nutrition_reference_foods").select("id,name,kcal_per_100g,protein_g_per_100g,carbs_g_per_100g,fat_g_per_100g,fiber_g_per_100g,sugar_g_per_100g,sodium_mg_per_100g,confidence,source,version").eq("id", portion.reference_id).maybeSingle()).data as NutritionReference | null
      : await findNutritionReference(portion.name);
    if (!ref) continue;
    const values = calculateNutrition(ref, portion.grams);
    items.push({ ...portion, ...values, confidence: Number(ref.confidence) });
  }
  const totals = items.reduce((a, x) => ({
    grams: a.grams + x.grams, kcal: a.kcal + x.kcal, protein_g: a.protein_g + x.protein_g, carbs_g: a.carbs_g + x.carbs_g,
    fat_g: a.fat_g + x.fat_g, fiber_g: a.fiber_g + x.fiber_g, sugar_g: a.sugar_g + x.sugar_g, sodium_mg: a.sodium_mg + x.sodium_mg,
  }), { grams: 0, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 });
  const macroKcal = 4 * totals.protein_g + 4 * totals.carbs_g + 9 * totals.fat_g;
  const delta = totals.kcal ? Math.abs(macroKcal - totals.kcal) / totals.kcal * 100 : 0;
  return { items, totals, confidence: items.length ? n(items.reduce((s, x) => s + x.confidence, 0) / items.length, 2) : 0, calorie_check: { macro_kcal: Math.round(macroKcal), reported_kcal: totals.kcal, delta_percent: n(delta, 1), consistent: delta <= 10 } };
}
