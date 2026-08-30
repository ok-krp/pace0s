import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEGAL_VERSIONS } from "./legal";
import { AI_MODEL, PHOTO_INSTRUCTIONS, extractJson, foodAnalysisSchema, validateImageBase64 } from "./nutrition-ai.shared";

function getGeminiModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("L’IA Pace n’est pas configurée sur le serveur.");
  const google = createGoogleGenerativeAI({ apiKey: key });
  return google(AI_MODEL.replace(/^google\//, ""));
}

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
    const { data: consent, error: consentError } = await context.supabase
      .from("legal_consent")
      .select("opts")
      .eq("user_id", context.userId)
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (consentError) throw new Error(consentError.message);
    if ((consent?.opts as { ai?: boolean } | null)?.ai !== true) {
      return { error: "Consentement Analyse IA requis", result: null };
    }
    const imageCheck = validateImageBase64(data.imageBase64);
    if (!imageCheck.ok) return { error: imageCheck.error, result: null };

    try {
      const prompt = [
        PHOTO_INSTRUCTIONS,
        data.goal ? `Objectif de l'utilisateur : ${data.goal}.` : "",
        data.hint ? `Indice fourni par l'utilisateur : ${data.hint}.` : "",
        "Analyse la photo ci-dessous et réponds en JSON pur.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const { text } = await generateText({
        model: getGeminiModel(),
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

export const nutritionAdvice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { summary: string }) => z.object({ summary: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: consent, error: consentError } = await context.supabase
      .from("legal_consent")
      .select("opts")
      .eq("user_id", context.userId)
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (consentError) throw new Error(consentError.message);
    if ((consent?.opts as { ai?: boolean } | null)?.ai !== true) {
      return { advice: null, error: "Consentement Analyse IA requis" };
    }
    try {
      const { text } = await generateText({
        model: getGeminiModel(),
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