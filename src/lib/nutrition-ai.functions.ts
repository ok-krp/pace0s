import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEGAL_VERSIONS } from "./legal";

export const analyzeFoodPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageBase64: string; goal?: string }) => {
    return z.object({
      imageBase64: z.string().min(20).max(8_000_000),
      goal: z.string().optional(),
    }).parse(d);
  })
  .handler(async ({ data, context }) => {
    const { data: consent, error: consentError } = await context.supabase
      .from("legal_consent")
      .select("opts")
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (consentError) throw new Error(consentError.message);
    if ((consent?.opts as { ai?: boolean } | null)?.ai !== true) {
      return { error: "Consentement Analyse IA requis", result: null };
    }
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { error: "AI Gateway non configuré", result: null };

    try {
      const gateway = createLovableAiGatewayProvider(key);
      const model = gateway("google/gemini-2.5-flash");
      const sys = `Tu es un nutritionniste expert. Analyse la photo d'un plat et estime ses macros.
Sois précis sur les quantités. health_score: green=sain, orange=moyen, red=ultra transformé/très gras/très sucré.
quality: bulking | cutting | balanced | treat.
Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de \`\`\`), avec EXACTEMENT ces clés:
{"dish_name":string,"detected_items":string[],"estimated_grams":number,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sodium_mg":number,"health_score":"green"|"orange"|"red","quality":"bulking"|"cutting"|"balanced"|"treat","confidence":number,"notes":string}
Réponds en français pour dish_name, detected_items et notes.${data.goal ? ` Objectif utilisateur: ${data.goal}.` : ""}`;
      const { text } = await generateText({
        model,
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyse ce plat. Réponds en JSON pur." },
              { type: "image", image: data.imageBase64 },
            ],
          },
        ],
      });
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const foodAnalysisSchema = z.object({
        dish_name: z.string(),
        detected_items: z.array(z.string()),
        estimated_grams: z.number(),
        kcal: z.number(),
        protein_g: z.number(),
        carbs_g: z.number(),
        fat_g: z.number(),
        fiber_g: z.number(),
        sodium_mg: z.number(),
        health_score: z.enum(["green", "orange", "red"]),
        quality: z.enum(["bulking", "cutting", "balanced", "treat"]),
        confidence: z.number().min(0).max(1),
        notes: z.string(),
      });
      const parsed = foodAnalysisSchema.safeParse(JSON.parse(cleaned));
      if (!parsed.success) {
        console.error("AI JSON invalide", parsed.error, cleaned.slice(0, 500));
        return { error: "Réponse IA invalide", result: null };
      }
      return { error: null, result: parsed.data };
    } catch (e) {
      console.error("analyzeFoodPhoto error", e);
      const msg = e instanceof Error ? e.message : "Erreur IA";
      return { error: msg, result: null };
    }
  });

export const nutritionAdvice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { summary: string }) =>
    z.object({ summary: z.string().min(1).max(4000) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: consent, error: consentError } = await context.supabase
      .from("legal_consent")
      .select("opts")
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (consentError) throw new Error(consentError.message);
    if ((consent?.opts as { ai?: boolean } | null)?.ai !== true) {
      return { advice: null, error: "Consentement Analyse IA requis" };
    }
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { advice: null, error: "AI Gateway non configuré" };
    try {
      const gateway = createLovableAiGatewayProvider(key);
      const model = gateway("google/gemini-2.5-flash");
      const { text } = await generateText({
        model,
        messages: [
          {
            role: "system",
            content:
              "Tu es un coach nutrition. Donne 3 conseils ULTRA courts (1 ligne chacun), actionnables, en français. Format: '• conseil'. Pas de salutation, pas d'intro.",
          },
          { role: "user", content: data.summary },
        ],
      });
      return { advice: text, error: null };
    } catch (e) {
      return { advice: null, error: e instanceof Error ? e.message : "Erreur IA" };
    }
  });
