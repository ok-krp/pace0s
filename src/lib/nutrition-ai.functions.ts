import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEGAL_VERSIONS } from "./legal";

const MODEL = "google/gemini-3.6-flash";

async function hasAiConsent(supabase: {
  from: (t: string) => {
    select: (c: string) => {
      eq: (a: string, b: string) => {
        eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }> };
      };
    };
  };
}) {
  const { data, error } = await supabase
    .from("legal_consent")
    .select("opts")
    .eq("eula_version", LEGAL_VERSIONS.eula)
    .eq("privacy_version", LEGAL_VERSIONS.privacy)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as { opts?: { ai?: boolean } } | null)?.opts?.ai ?? false) === true;
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("JSON introuvable dans la réponse IA");
  }
}

/* ------------------------------------------------------------------ */
/* 1. Analyse photo (niveau MacroFactor)                               */
/* ------------------------------------------------------------------ */

const foodItemSchema = z.object({
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

const foodAnalysisSchema = z.object({
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

const PHOTO_INSTRUCTIONS = `Tu es un nutritionniste-diététicien expert en estimation visuelle de portions (niveau MacroFactor).

MÉTHODE OBLIGATOIRE (raisonne en interne, ne l'écris pas) :
1. Identifie CHAQUE aliment visible séparément (protéine, féculent, légume, sauce, matière grasse de cuisson, boisson, dessert).
2. Reconnais la marque si un emballage, logo ou produit industriel identifiable est visible (sinon brand = null).
3. Estime le poids de chaque aliment en grammes en t'appuyant sur des repères d'échelle : diamètre d'assiette standard 26 cm, fourchette 19 cm, verre 250 ml, main, canette 33 cl.
4. Applique des valeurs nutritionnelles de table (CIQUAL/USDA) au poids estimé, cuisson comprise. N'oublie pas l'huile/beurre de cuisson et les sauces, souvent invisibles mais caloriques.
5. Vérifie la cohérence : kcal ≈ 4×protéines + 4×glucides + 9×lipides (±10 %). Corrige avant de répondre.

confidence : 0.9+ si aliments nets et portions évidentes ; 0.5-0.7 si sauces/quantités ambiguës ; <0.5 si photo floue ou plat composite non identifiable.
health_score : green = sain, orange = moyen, red = ultra transformé / très gras / très sucré.
quality : bulking | cutting | balanced | treat.

Réponds UNIQUEMENT avec un objet JSON valide (aucun markdown, aucun texte autour) :
{"dish_name":string,"items":[{"name":string,"brand":string|null,"grams":number,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sugar_g":number,"sodium_mg":number}],"health_score":"green"|"orange"|"red","quality":"bulking"|"cutting"|"balanced"|"treat","confidence":number,"confidence_note":string,"notes":string}

Les valeurs de chaque item correspondent à SA portion estimée (pas pour 100 g). Rédige name, dish_name, confidence_note et notes en français.`;

export const analyzeFoodPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageBase64: string; goal?: string; hint?: string }) =>
    z
      .object({
        imageBase64: z.string().min(20).max(8_000_000),
        goal: z.string().max(300).optional(),
        hint: z.string().max(300).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    if (!(await hasAiConsent(context.supabase))) {
      return { error: "Consentement Analyse IA requis", result: null };
    }
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { error: "AI Gateway non configuré", result: null };

    try {
      const gateway = createLovableAiGatewayProvider(key);
      const prompt = [
        PHOTO_INSTRUCTIONS,
        data.goal ? `Objectif de l'utilisateur : ${data.goal}.` : "",
        data.hint ? `Indice fourni par l'utilisateur : ${data.hint}.` : "",
        "Analyse la photo ci-dessous et réponds en JSON pur.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const { text } = await generateText({
        model: gateway(MODEL),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", image: data.imageBase64 },
            ],
          },
        ],
      });

      const parsed = foodAnalysisSchema.safeParse(extractJson(text));
      if (!parsed.success) {
        console.error("AI JSON invalide", parsed.error, text.slice(0, 500));
        return { error: "Réponse IA invalide", result: null };
      }
      return { error: null, result: parsed.data };
    } catch (e) {
      console.error("analyzeFoodPhoto error", e);
      return { error: e instanceof Error ? e.message : "Erreur IA", result: null };
    }
  });

/* ------------------------------------------------------------------ */
/* 2. Conseils nutrition                                               */
/* ------------------------------------------------------------------ */

export const nutritionAdvice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { summary: string }) => z.object({ summary: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await hasAiConsent(context.supabase))) {
      return { advice: null, error: "Consentement Analyse IA requis" };
    }
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { advice: null, error: "AI Gateway non configuré" };
    try {
      const gateway = createLovableAiGatewayProvider(key);
      const { text } = await generateText({
        model: gateway(MODEL),
        messages: [
          {
            role: "user",
            content: `Tu es un coach nutrition. À partir du résumé ci-dessous, donne 3 conseils ULTRA courts (1 ligne chacun), actionnables, en français, au format "• conseil". Pas de salutation, pas d'introduction.\n\nRésumé :\n${data.summary}`,
          },
        ],
      });
      return { advice: text, error: null };
    } catch (e) {
      return { advice: null, error: e instanceof Error ? e.message : "Erreur IA" };
    }
  });
