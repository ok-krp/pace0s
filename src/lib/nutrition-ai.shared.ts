import { z } from "zod";

export const AI_MODEL = "google/gemini-3.7-flash";

export const foodItemSchema = z.object({
  name: z.string(),
  brand: z.string().nullable().default(null),
  grams: z.number().min(0),
  kcal: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
  fiber_g: z.number().min(0).default(0),
  sugar_g: z.number().min(0).default(0),
  sodium_mg: z.number().min(0).default(0),
});

export const foodAnalysisSchema = z.object({
  dish_name: z.string(),
  items: z.array(foodItemSchema).min(1),
  health_score: z.enum(["green", "orange", "red"]),
  quality: z.enum(["bulking", "cutting", "balanced", "treat"]),
  confidence: z.number().min(0).max(1),
  confidence_note: z.string().default(""),
  notes: z.string().default(""),
});

export type FoodItem = z.infer<typeof foodItemSchema>;
export type FoodAnalysis = z.infer<typeof foodAnalysisSchema>;

export type FoodTotals = {
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
};

export function sumItems(items: FoodItem[]): FoodTotals {
  const r = (n: number) => Math.round(n * 10) / 10;
  return items.reduce<FoodTotals>((a, x) => ({
    grams: r(a.grams + (x.grams || 0)), kcal: Math.round(a.kcal + (x.kcal || 0)),
    protein_g: r(a.protein_g + (x.protein_g || 0)), carbs_g: r(a.carbs_g + (x.carbs_g || 0)),
    fat_g: r(a.fat_g + (x.fat_g || 0)), fiber_g: r(a.fiber_g + (x.fiber_g || 0)),
    sugar_g: r(a.sugar_g + (x.sugar_g || 0)), sodium_mg: r(a.sodium_mg + (x.sodium_mg || 0)),
  }), { grams: 0, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 });
}

export function scaleItem(item: FoodItem, grams: number): FoodItem {
  const base = item.grams || 1; const f = grams / base; const r = (n: number) => Math.round(n * f * 10) / 10;
  return { ...item, grams: Math.round(grams), kcal: Math.round(item.kcal * f), protein_g: r(item.protein_g), carbs_g: r(item.carbs_g), fat_g: r(item.fat_g), fiber_g: r(item.fiber_g), sugar_g: r(item.sugar_g), sodium_mg: r(item.sodium_mg) };
}

export const PHOTO_INSTRUCTIONS = `Tu es un nutritionniste-diététicien expert en estimation visuelle de portions.

OBJECTIF PRIORITAIRE : EXHAUSTIVITÉ. Reconnais tous les aliments et composants réellement visibles, même les petits ou partiellement masqués.

MÉTHODE OBLIGATOIRE (raisonne en interne, ne l'écris pas) :
1. Fais un inventaire visuel complet avant de répondre. Sépare chaque composant visible : protéine, féculent, légumes, fruits, pain, fromage, garniture, sauce, huile/beurre, boisson, dessert et condiments.
2. N'omets jamais un aliment parce que sa quantité ou son nom est incertain. Si nécessaire, utilise un nom générique précis et une confiance plus faible.
3. Si plusieurs aliments sont mélangés mais visuellement distinguables, crée plusieurs items. Ne transforme pas un plat composite en un seul item générique si ses composants sont visibles.
4. Reconnais la marque si un emballage, logo ou produit industriel identifiable est visible ; sinon brand = null.
5. Estime le poids de CHAQUE item en grammes avec des repères d'échelle : assiette standard 26 cm, fourchette 19 cm, verre 250 ml, main, canette 33 cl.
6. Estime aussi les sauces et matières grasses visibles ou raisonnablement déductibles. Ne les ignore pas simplement parce qu'elles sont petites.
7. Donne pour chaque item une estimation nutritionnelle de sa portion. Ces valeurs servent de secours uniquement lorsqu'aucune référence Pace fiable n'est disponible.
8. Vérifie la cohérence : kcal ≈ 4×protéines + 4×glucides + 9×lipides (±10 %).
9. Ne transforme plusieurs aliments en un seul item « repas » sauf si aucun composant ne peut raisonnablement être séparé.

confidence : 0.9+ si aliments nets et portions évidentes ; 0.5-0.7 si sauces/quantités ambiguës ; <0.5 si photo floue ou plat composite difficile à identifier.
health_score : green = sain, orange = moyen, red = ultra transformé / très gras / très sucré.
quality : bulking | cutting | balanced | treat.

Réponds UNIQUEMENT avec un objet JSON valide :
{"dish_name":string,"items":[{"name":string,"brand":string|null,"grams":number,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sugar_g":number,"sodium_mg":number}],"health_score":"green"|"orange"|"red","quality":"bulking"|"cutting"|"balanced"|"treat","confidence":number,"confidence_note":string,"notes":string}

Les valeurs de chaque item correspondent à SA portion estimée, pas à 100 g. Rédige name, dish_name, confidence_note et notes en français.`;

export function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}"); if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)); throw new Error("JSON introuvable dans la réponse IA"); }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function validateImageBase64(input: string): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  const withoutPrefix = input.replace(/^data:[^;]+;base64,/, ""); let bytes: Buffer;
  try { bytes = Buffer.from(withoutPrefix, "base64"); } catch { return { ok: false, error: "Fichier illisible (pas du base64 valide)." }; }
  if (bytes.length === 0) return { ok: false, error: "Fichier vide." };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: `Image trop lourde (${(bytes.length / 1024 / 1024).toFixed(1)} Mo, max 8 Mo).` };
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isJpeg && !isPng && !isWebp) return { ok: false, error: "Format non reconnu — seuls JPEG, PNG et WebP sont acceptés." };
  return { ok: true, bytes };
}
