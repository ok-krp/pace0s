import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { getPreferencesServer } from "./ai-history.server";
import type { AgentType, AiPermissions } from "./ai-history.types";

type Client = SupabaseClient<Database>;
type ChatBody = { messages?: unknown; conversationId?: unknown; agentType?: unknown; ephemeral?: unknown };

function apiKey() {
  const value = process.env.LOVABLE_API_KEY;
  if (!value) throw new Error("Lovable AI n’est pas configuré.");
  return value;
}

async function authenticatedClient(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) throw new Response("Non autorisé", { status: 401 });
  const client = createClient<Database>(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Response("Non autorisé", { status: 401 });
  return { client, userId: data.user.id };
}

async function contextForCoach(client: Client, userId: string, permissions: AiPermissions) {
  const context: Record<string, unknown> = {};
  if (permissions.profile) {
    const { data } = await client.from("profiles").select("display_name,age,sex,height_cm,weight_kg,weight_goal_kg,daily_calorie_goal,daily_protein_goal,daily_water_ml_goal,training_goal,activity_level").eq("user_id", userId).maybeSingle();
    context.profile = data;
  }
  if (permissions.nutrition) {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await client.from("food_log").select("meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg").eq("user_id", userId).eq("log_date", today).order("created_at");
    context.todayNutrition = data;
  }
  return context;
}

async function logAction(client: Client, userId: string, conversationId: string, agentType: AgentType, actionType: string, label: string, payload: unknown, status: "executed" | "failed") {
  await client.from("ai_action_log").insert({ user_id: userId, conversation_id: conversationId, agent_type: agentType, action_type: actionType, label, payload: payload as Json, status, executed_at: status === "executed" ? new Date().toISOString() : null });
}

function coachTools(client: Client, userId: string, conversationId: string, permissions: AiPermissions) {
  return {
    update_profile: tool({
      description: "Mettre à jour le poids, les objectifs ou les informations du profil Pace.",
      inputSchema: z.object({ weight_kg: z.number().nullable(), weight_goal_kg: z.number().nullable(), daily_calorie_goal: z.number().nullable(), daily_protein_goal: z.number().nullable(), daily_water_ml_goal: z.number().nullable(), training_goal: z.string().nullable() }),
      execute: async (input) => {
        if (!permissions.profile) return { ok: false, message: "Permission Profil désactivée" };
        const patch: Database["public"]["Tables"]["profiles"]["Update"] = {
          ...(input.weight_kg === null ? {} : { weight_kg: input.weight_kg }),
          ...(input.weight_goal_kg === null ? {} : { weight_goal_kg: input.weight_goal_kg }),
          ...(input.daily_calorie_goal === null ? {} : { daily_calorie_goal: input.daily_calorie_goal }),
          ...(input.daily_protein_goal === null ? {} : { daily_protein_goal: input.daily_protein_goal }),
          ...(input.daily_water_ml_goal === null ? {} : { daily_water_ml_goal: input.daily_water_ml_goal }),
          ...(input.training_goal === null ? {} : { training_goal: input.training_goal }),
        };
        const { error } = await client.from("profiles").update(patch).eq("user_id", userId);
        if (error) { await logAction(client, userId, conversationId, "coach", "update_profile", "Mise à jour du profil", input, "failed"); throw new Error(error.message); }
        await logAction(client, userId, conversationId, "coach", "update_profile", "Profil mis à jour", input, "executed");
        return { ok: true, message: "Profil mis à jour" };
      },
    }),
    add_food: tool({
      description: "Ajouter un repas ou aliment au journal nutritionnel avec estimation complète des macros.",
      inputSchema: z.object({ name: z.string(), meal: z.string(), kcal: z.number(), protein_g: z.number(), carbs_g: z.number(), fat_g: z.number(), fiber_g: z.number(), sugar_g: z.number(), sodium_mg: z.number(), grams: z.number() }),
      execute: async (input) => {
        if (!permissions.nutrition) return { ok: false, message: "Permission Nutrition désactivée" };
        const { error } = await client.from("food_log").insert({ user_id: userId, name: `${input.name} (${Math.round(input.grams)} g)`, meal: input.meal, kcal: input.kcal, protein_g: input.protein_g, carbs_g: input.carbs_g, fat_g: input.fat_g, fiber_g: input.fiber_g, sugar_g: input.sugar_g, sodium_mg: input.sodium_mg, source: "coach_ai" });
        if (error) { await logAction(client, userId, conversationId, "coach", "add_food", "Ajout nutrition", input, "failed"); throw new Error(error.message); }
        await logAction(client, userId, conversationId, "coach", "add_food", `${input.name} ajouté`, input, "executed");
        return { ok: true, message: `${input.name} ajouté au journal` };
      },
    }),
    add_health_sample: tool({
      description: "Enregistrer une mesure de santé comme le poids ou la masse grasse.",
      inputSchema: z.object({ type: z.string(), value: z.number() }),
      execute: async (input) => {
        if (!permissions.profile) return { ok: false, message: "Permission Profil désactivée" };
        const { error } = await client.from("health_samples").insert({ user_id: userId, type: input.type, value: input.value, source: "coach_ai" });
        if (error) { await logAction(client, userId, conversationId, "coach", "add_health_sample", "Mesure de santé", input, "failed"); throw new Error(error.message); }
        await logAction(client, userId, conversationId, "coach", "add_health_sample", `${input.type} enregistré`, input, "executed");
        return { ok: true, message: "Mesure enregistrée" };
      },
    }),
  };
}

function buildTools(client: Client, userId: string, conversationId: string) {
  return {
    create_development_task: tool({
      description: "Créer un bug, une amélioration, une fonctionnalité ou une tâche dans le centre Développement de Pace.",
      inputSchema: z.object({ kind: z.enum(["bug", "improvement", "feature", "task"]), title: z.string(), description: z.string(), priority: z.enum(["low", "medium", "high", "critical"]) }),
      execute: async (input) => {
        const { error } = await client.from("development_tasks").insert({ ...input, user_id: userId, conversation_id: conversationId });
        if (error) { await logAction(client, userId, conversationId, "build", "create_development_task", "Création d’une tâche", input, "failed"); throw new Error(error.message); }
        await logAction(client, userId, conversationId, "build", "create_development_task", `${input.kind} créé : ${input.title}`, input, "executed");
        return { ok: true, message: `${input.kind} créé dans Développement` };
      },
    }),
  };
}

export async function handleAiChat(request: Request) {
  const body = (await request.json()) as ChatBody;
  if (!Array.isArray(body.messages) || typeof body.conversationId !== "string" || (body.agentType !== "coach" && body.agentType !== "build")) return new Response("Requête invalide", { status: 400 });
  const messages = body.messages as UIMessage[];
  const agentType = body.agentType;
  const ephemeral = body.ephemeral === true;
  const { client, userId } = await authenticatedClient(request);
  if (!ephemeral) {
    const { data } = await client.from("ai_conversations").select("id").eq("id", body.conversationId).eq("user_id", userId).eq("agent_type", agentType).maybeSingle();
    if (!data) return new Response("Conversation introuvable", { status: 404 });
  }
  const preferences = await getPreferencesServer(client, userId);
  const newest = messages[messages.length - 1];
  if (!ephemeral && newest?.role === "user") {
    const text = newest.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const { data: exists } = await client.from("ai_messages").select("id").eq("conversation_id", body.conversationId).eq("model_message_id", newest.id).maybeSingle();
    if (!exists) await client.from("ai_messages").insert({ conversation_id: body.conversationId, user_id: userId, role: "user", parts: newest.parts as unknown as Json, plain_text: text, model_message_id: newest.id });
  }

  const key = apiKey();
  const lovable = createOpenAI({ baseURL: "https://ai.gateway.lovable.dev/v1", apiKey: key, headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  const dataContext = agentType === "coach" ? await contextForCoach(client, userId, preferences.permissions) : {};
  const tools = agentType === "coach" ? coachTools(client, userId, body.conversationId, preferences.permissions) : buildTools(client, userId, body.conversationId);
  const instructions = agentType === "coach"
    ? `Tu es Coach IA, le coach personnel francophone de Pace. Tu utilises automatiquement les données autorisées ci-dessous sans redemander ce qui est déjà connu. Tu donnes des réponses précises, bienveillantes et actionnables. Quand l'utilisateur demande une modification, utilise l'outil approprié. Après chaque outil, confirme clairement avec ✓ et la modification exacte. Données autorisées: ${JSON.stringify(dataContext)}. Niveau mémoire: ${preferences.memory_level}. Ne parle jamais du développement de Pace; redirige ces demandes vers BUILD IA.`
    : "Tu es BUILD IA, l'assistant de développement francophone de Pace. Tu transformes automatiquement les signalements en bugs, améliorations, fonctionnalités ou tâches structurées avec priorité. Tu n'es pas un coach santé et rediriges ces demandes vers Coach IA. Tu ne prétends jamais modifier le code source; tu peux analyser, cadrer et créer des éléments dans le centre Développement.";

  const toolApproval = Object.fromEntries(Object.keys(tools).map((name) => [name, preferences.confirm_actions ? "user-approval" : "not-applicable"]));
  const result = streamText({
    model: lovable.responses("openai/gpt-5.6-sol"),
    system: instructions,
    messages: await convertToModelMessages(messages),
    tools,
    toolApproval,
    stopWhen: stepCountIs(50),
    providerOptions: { openai: { forceReasoning: true, reasoningEffort: "medium", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    sendReasoning: true,
    onEnd: async ({ responseMessage }) => {
      if (ephemeral) return;
      const text = responseMessage.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      await client.from("ai_messages").insert({ conversation_id: body.conversationId as string, user_id: userId, role: "assistant", parts: responseMessage.parts as unknown as Json, plain_text: text, model_message_id: responseMessage.id });
      await client.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", body.conversationId as string).eq("user_id", userId);
      const { data: conversation } = await client.from("ai_conversations").select("title").eq("id", body.conversationId as string).maybeSingle();
      if (conversation?.title === "Nouvelle conversation") {
        const firstText = messages.flatMap((message) => message.parts).find((part) => part.type === "text");
        if (firstText?.type === "text") await client.from("ai_conversations").update({ title: firstText.text.trim().replace(/\s+/g, " ").slice(0, 52) }).eq("id", body.conversationId as string).eq("user_id", userId);
      }
    },
  });
}