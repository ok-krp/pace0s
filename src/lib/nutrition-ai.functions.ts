import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LEGAL_VERSIONS } from "./legal";
import { AI_MODEL, PHOTO_INSTRUCTIONS, extractJson, foodAnalysisSchema } from "./nutrition-ai.shared";
import { calculateReferenceBasedNutrition, findDishReference, scaleDishReference } from "./nutrition-engine";

const PHOTO_BUCKET = "nutrition-ai";
const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
const visionItemSchema = z.object({ name: z.string().min(1).max(200), brand: z.string().nullable().default(null), grams: z.number().min(0).max(50000) });
const visionSchema = z.object({ dish_name: z.string().min(1).max(300), items: z.array(visionItemSchema).min(1).max(50), health_score: z.enum(["green", "orange", "red"]), quality: z.enum(["bulking", "cutting", "balanced", "treat"]), confidence: z.number().min(0).max(1), confidence_note: z.string().default(""), notes: z.string().default("") });
function getGeminiModel() { const key = process.env.GEMINI_API_KEY; if (!key) throw new Error("L’IA Pace n’est pas configurée sur le serveur."); return createGoogleGenerativeAI({ apiKey: key })(AI_MODEL.replace(/^google\//, "")); }
function storagePathForUser(userId: string, path: string) { const normalized = path.replace(/^\/+/, ""); if (!normalized || normalized.includes("..") || !normalized.startsWith(`${userId}/`)) throw new Error("Référence image invalide."); return normalized; }

export const analyzeFoodPhoto = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d: { storagePath: string; goal?: string; hint?: string }) => z.object({ storagePath: z.string().min(3).max(500), goal: z.string().max(300).optional(), hint: z.string().max(300).optional() }).parse(d)).handler(async ({ data, context }) => {
  const { data: consent, error: consentError } = await context.supabase.from("legal_consent").select("opts").eq("user_id", context.userId).eq("eula_version", LEGAL_VERSIONS.eula).eq("privacy_version", LEGAL_VERSIONS.privacy).maybeSingle();
  if (consentError) throw new Error(consentError.message);
  if ((consent?.opts as { ai?: boolean } | null)?.ai !== true) return { error: "Consentement Analyse IA requis", result: null };
  const path = storagePathForUser(context.userId, data.storagePath);
  try {
    const { data: file, error: downloadError } = await supabaseAdmin.storage.from(PHOTO_BUCKET).download(path);
    if (downloadError || !file) throw new Error("Image introuvable ou inaccessible.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) throw new Error("Image trop lourde ou vide.");
    const contentType = file.type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("Format image non autorisé.");
    const imageDataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
    const prompt = [PHOTO_INSTRUCTIONS, "IMPORTANT : identifie uniquement le plat, les aliments/composants et les grammes estimés. NE FOURNIS AUCUNE valeur kcal ou macro.", "Si le plat correspond à un plat connu, donne son nom canonique clairement (ex. Double Bacon Cheeseburger).", data.goal ? `Objectif : ${data.goal}.` : "", data.hint ? `Indice : ${data.hint}.` : "", "Réponds en JSON pur avec dish_name, items [{name,brand,grams}], health_score, quality, confidence, confidence_note, notes."].filter(Boolean).join("\n\n");
    const { text } = await generateText({ model: getGeminiModel(), messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", image: imageDataUrl }] }] });
    const parsed = visionSchema.safeParse(extractJson(text));
    if (!parsed.success) return { error: "Réponse IA invalide", result: null };

    const dish = await findDishReference(parsed.data.dish_name);
    if (dish && parsed.data.confidence >= 0.65) {
      const grams = parsed.data.items.reduce((sum, item) => sum + item.grams, 0) || Number(dish.portion_g);
      const values = scaleDishReference(dish, grams);
      const macroKcal = 4 * values.protein_g + 4 * values.carbs_g + 9 * values.fat_g;
      const delta = values.kcal ? Math.abs(macroKcal - values.kcal) / values.kcal * 100 : 0;
      const result = foodAnalysisSchema.parse({ dish_name: dish.canonical_name, items: [{ name: dish.canonical_name, brand: null, grams, ...values }], health_score: parsed.data.health_score, quality: parsed.data.quality, confidence: Math.min(parsed.data.confidence, Number(dish.confidence)), confidence_note: `${parsed.data.confidence_note} Référence calibrée Pace : ${Math.round(Number(dish.confidence) * 100)} %.`, notes: `${parsed.data.notes} Valeurs issues d'une référence de plat calibrée, redimensionnée à la portion estimée.`, });
      if (Math.abs(macroKcal - values.kcal) / Math.max(values.kcal, 1) > 0.1) return { error: "Référence nutritionnelle incohérente", result: null };
      return { error: null, result };
    }

    const nutrition = await calculateReferenceBasedNutrition(parsed.data.items.map(x => ({ name: x.name, grams: x.grams })));
    const result = foodAnalysisSchema.parse({ dish_name: parsed.data.dish_name, items: nutrition.items.map((x, i) => ({ name: x.name, brand: parsed.data.items[i]?.brand ?? null, grams: x.grams, kcal: x.kcal, protein_g: x.protein_g, carbs_g: x.carbs_g, fat_g: x.fat_g, fiber_g: x.fiber_g, sugar_g: x.sugar_g, sodium_mg: x.sodium_mg })), health_score: parsed.data.health_score, quality: parsed.data.quality, confidence: Math.min(parsed.data.confidence, nutrition.confidence || parsed.data.confidence), confidence_note: `${parsed.data.confidence_note} Références nutritionnelles : ${Math.round((nutrition.confidence || 0) * 100)} %.`, notes: `${parsed.data.notes}${nutrition.items.length < parsed.data.items.length ? " Certains aliments n’ont pas de référence nutritionnelle fiable et ont été exclus du calcul." : ""}` });
    return { error: null, result };
  } catch (e) { console.error("analyzeFoodPhoto error", e); return { error: e instanceof Error ? e.message : "Erreur IA", result: null }; }
  finally { await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path]).catch(() => undefined); }
});

export const nutritionAdvice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d: { summary: string }) => z.object({ summary: z.string().min(1).max(4000) }).parse(d)).handler(async ({ data, context }) => {
  const { data: consent, error: consentError } = await context.supabase.from("legal_consent").select("opts").eq("user_id", context.userId).eq("eula_version", LEGAL_VERSIONS.eula).eq("privacy_version", LEGAL_VERSIONS.privacy).maybeSingle();
  if (consentError) throw new Error(consentError.message);
  if ((consent?.opts as { ai?: boolean } | null)?.ai !== true) return { advice: null, error: "Consentement Analyse IA requis" };
  try { const { text } = await generateText({ model: getGeminiModel(), messages: [{ role: "user", content: `Tu es un coach nutrition. À partir du résumé ci-dessous, donne 3 conseils ULTRA courts (1 ligne chacun), actionnables, en français, au format "• conseil". Pas de salutation, pas d'introduction. Ne recalcule jamais les macros dans ce texte : si des macros sont nécessaires, elles doivent provenir du Pace Nutrition Engine.\n\nRésumé :\n${data.summary}` }] }); return { advice: text, error: null }; } catch (e) { return { advice: null, error: e instanceof Error ? e.message : "Erreur IA" }; }
});
