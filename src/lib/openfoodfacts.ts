// Open Food Facts public API — no key required
export type OFFProduct = {
  barcode: string;
  name: string;
  brand: string;
  image_url: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sat_fat_g: number;
  fiber_g: number;
  sugar_g: number;
  salt_g: number;
  sodium_mg: number;
  iron_mg: number;
  calcium_mg: number;
  vit_c_mg: number;
  nutri_score: string | null;
  nova_group: number | null;
  ingredients: string;
  additives: string[];
  allergens: string[];
};

export async function fetchProductByBarcode(barcode: string): Promise<OFFProduct | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,brands,image_url,nutriments,nutriscore_grade,nova_group,ingredients_text,additives_tags,allergens_tags`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.product) return null;
  const p = data.product;
  const n = p.nutriments ?? {};
  const num = (k: string) => Number(n[k]) || 0;
  return {
    barcode,
    name: p.product_name || "Produit inconnu",
    brand: p.brands || "",
    image_url: p.image_url ?? null,
    kcal: num("energy-kcal_100g"),
    protein_g: num("proteins_100g"),
    carbs_g: num("carbohydrates_100g"),
    fat_g: num("fat_100g"),
    sat_fat_g: num("saturated-fat_100g"),
    fiber_g: num("fiber_100g"),
    sugar_g: num("sugars_100g"),
    salt_g: num("salt_100g"),
    sodium_mg: num("sodium_100g") * 1000,
    iron_mg: num("iron_100g") * 1000,
    calcium_mg: num("calcium_100g") * 1000,
    vit_c_mg: num("vitamin-c_100g") * 1000,
    nutri_score: p.nutriscore_grade ? String(p.nutriscore_grade).toUpperCase() : null,
    nova_group: p.nova_group ?? null,
    ingredients: p.ingredients_text || "",
    additives: (p.additives_tags ?? []).map((x: string) => x.replace("en:", "")),
    allergens: (p.allergens_tags ?? []).map((x: string) => x.replace("en:", "")),
  };
}

export function computeHealthScore(p: OFFProduct): { score: "green" | "orange" | "red"; warnings: string[] } {
  const warnings: string[] = [];
  let s = 0;
  if (p.nutri_score === "A") s += 2;
  else if (p.nutri_score === "B") s += 1;
  else if (p.nutri_score === "D") s -= 1;
  else if (p.nutri_score === "E") s -= 2;

  if (p.nova_group && p.nova_group >= 4) { s -= 2; warnings.push("Ultra transformé (NOVA 4)"); }
  if (p.sugar_g > 15) { s -= 1; warnings.push("Trop sucré"); }
  if (p.salt_g > 1.5) { s -= 1; warnings.push("Trop salé"); }
  if (p.fiber_g >= 6) s += 1;
  if (p.protein_g >= 10) s += 1;
  if (p.additives.length >= 4) { s -= 1; warnings.push(`${p.additives.length} additifs`); }

  const score = s >= 1 ? "green" : s >= -1 ? "orange" : "red";
  return { score, warnings };
}

// 0-100 score: combines Nutri-Score, NOVA, sugar/salt/fiber/protein/additives
export function computeScore100(p: OFFProduct): number {
  let s = 60;
  const nutri: Record<string, number> = { A: 25, B: 12, C: 0, D: -12, E: -25 };
  if (p.nutri_score && nutri[p.nutri_score] !== undefined) s += nutri[p.nutri_score];
  if (p.nova_group) {
    if (p.nova_group === 1) s += 10;
    else if (p.nova_group === 2) s += 4;
    else if (p.nova_group === 3) s -= 6;
    else if (p.nova_group === 4) s -= 18;
  }
  if (p.sugar_g > 22.5) s -= 10;
  else if (p.sugar_g > 12) s -= 5;
  if (p.salt_g > 1.5) s -= 8;
  else if (p.salt_g > 0.9) s -= 4;
  if (p.fiber_g >= 6) s += 6;
  else if (p.fiber_g >= 3) s += 3;
  if (p.protein_g >= 12) s += 4;
  if (p.additives.length >= 6) s -= 10;
  else if (p.additives.length >= 3) s -= 5;
  else if (p.additives.length === 0) s += 4;
  return Math.max(0, Math.min(100, Math.round(s)));
}
