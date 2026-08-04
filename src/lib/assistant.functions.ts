import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEGAL_VERSIONS } from "./legal";

export const assistantActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("food"),
    name: z.string(),
    meal: z.string(),
    kcal: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    fiber_g: z.number(),
    sugar_g: z.number(),
    sodium_mg: z.number(),
    grams: z.number(),
  }),
  z.object({
    type: z.literal("workout"),
    exercise_id: z.string().nullable(),
    exercise_name: z.string(),
    muscle: z.string(),
    sets: z.number(),
    reps: z.number(),
    weight: z.number(),
  }),
]);

export type AssistantAction = z.infer<typeof assistantActionSchema>;

const replySchema = z.object({
  reply: z.string(),
  actions: z.array(assistantActionSchema),
});

export type AssistantReply = z.infer<typeof replySchema>;

const inputSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .default([]),
  exercises: z
    .array(z.object({ id: z.string(), name: z.string(), muscle: z.string() }))
    .max(200)
    .default([]),
});

export const assistantChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: consent, error: consentError } = await context.supabase
      .from("legal_consent")
      .select("opts")
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (consentError) throw new Error(consentError.message);
    if ((consent?.opts as { ai?: boolean } | null)?.ai !== true) {
      return { error: "Consentement Analyse IA requis", result: null as AssistantReply | null };
    }

    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { error: "AI Gateway non configuré", result: null as AssistantReply | null };

    const catalog = data.exercises.length
      ? data.exercises.map((e) => `${e.id}|${e.name}|${e.muscle}`).join("\n")
      : "(aucun exercice enregistré)";

    const instructions = `Tu es l'assistant Pace, un coach santé francophone qui PILOTE l'application.
Tu comprends le langage naturel et tu convertis les demandes en actions concrètes.

Exercices connus de l'utilisateur (id|nom|muscle) :
${catalog}

Règles :
- "Pec Fly 8 reps 2 séries 59 kg" → action workout (exercise_id = id du catalogue si le nom correspond, sinon null et propose un muscle plausible).
- "J'ai mangé un poulet curry avec du riz" → action food avec estimation réaliste des macros (repas déduit de l'heure ou du contexte : Petit-déjeuner, Déjeuner, Dîner, Collation).
- Si c'est une simple question, actions = [].
- reply : 1 à 3 phrases courtes en français, confirme ce que tu enregistres.

Réponds UNIQUEMENT avec un JSON valide (aucun markdown) :
{"reply":string,"actions":[{"type":"food","name":string,"meal":string,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sugar_g":number,"sodium_mg":number,"grams":number} | {"type":"workout","exercise_id":string|null,"exercise_name":string,"muscle":string,"sets":number,"reps":number,"weight":number}]}`;

    try {
      const lovable = createOpenAI({
        baseURL: "https://ai.gateway.lovable.dev/v1",
        apiKey: key,
        headers: {
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
        },
      });

      const result = streamText({
        model: lovable.responses("openai/gpt-5.6-sol"),
        system: instructions,
        messages: [...data.history, { role: "user" as const, content: data.message }],
        providerOptions: { openai: { store: false } },
      });

      const text = await result.text;
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const parsed = replySchema.safeParse(JSON.parse(cleaned));
      if (!parsed.success) {
        console.error("assistant JSON invalide", parsed.error, cleaned.slice(0, 400));
        return { error: "Réponse IA invalide", result: null as AssistantReply | null };
      }
      return { error: null as string | null, result: parsed.data };
    } catch (e) {
      console.error("assistantChat error", e);
      return {
        error: e instanceof Error ? e.message : "Erreur IA",
        result: null as AssistantReply | null,
      };
    }
  });
