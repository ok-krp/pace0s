import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { getPreferencesServer } from "./ai-history.server";
import type { AgentType, AiPermissions } from "./ai-history.types";

type Client = SupabaseClient<Database>;
type ChatBody = { messages?: unknown; conversationId?: unknown; agentType?: unknown; ephemeral?: unknown };

/** Nombre de messages récents envoyés tels quels au modèle. Tout ce qui précède est résumé. */
const RECENT_WINDOW = 30;
/** Sécurité anti-abus très large : aucune limite gênante pour l'utilisateur. */
const MAX_TEXT_CHARS = 400_000;

class ChatError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function fail(status: number, code: string, message: string): never {
  throw new ChatError(status, code, message);
}

function errorResponse(error: unknown, startedAt: number) {
  const known = error instanceof ChatError;
  const status = known ? error.status : 500;
  const code = known ? error.code : "internal_error";
  const message = known
    ? error.message
    : error instanceof Error
      ? `Erreur serveur : ${error.message}`
      : "Erreur serveur inattendue.";
  console.error("[ai-chat] échec", { code, status, ms: Date.now() - startedAt, message });
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Pace-Error-Code": code, "X-Pace-Duration-Ms": String(Date.now() - startedAt) },
  });
}

function apiKey() {
  const value = process.env.GEMINI_API_KEY;
  if (!value) fail(503, "ai_not_configured", "L’IA n’est pas configurée sur ce projet (clé Gemini manquante — variable d’environnement GEMINI_API_KEY).");
  return value;
}

async function authenticatedClient(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) fail(503, "cloud_not_configured", "Le Cloud n’est pas configuré côté serveur.");
  if (!token) fail(401, "no_session", "Session expirée : reconnectez-vous pour continuer la conversation.");
  const client = createClient<Database>(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) fail(401, "auth_expired", "Authentification expirée : reconnectez-vous puis renvoyez votre message.");
  return { client, userId: data.user!.id };
}

function textOf(message: UIMessage) {
  return message.parts.filter((part) => part.type === "text").map((part) => ("text" in part ? part.text : "")).join("\n");
}

async function contextForCoach(client: Client, userId: string, permissions: AiPermissions) {
  const context: Record<string, unknown> = {};
  const jobs: Promise<void>[] = [];
  if (permissions.profile) {
    jobs.push((async () => {
      const { data } = await client.from("profiles").select("display_name,age,sex,height_cm,weight_kg,weight_goal_kg,daily_calorie_goal,daily_protein_goal,daily_water_ml_goal,training_goal,activity_level").eq("user_id", userId).maybeSingle();
      context.profile = data;
    })());
  }
  if (permissions.nutrition) {
    jobs.push((async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await client.from("food_log").select("meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg").eq("user_id", userId).eq("log_date", today).order("created_at");
      context.todayNutrition = data;
    })());
  }
  await Promise.all(jobs);
  return context;
}

async function logAction(client: Client, userId: string, conversationId: string, agentType: AgentType, actionType: string, label: string, payload: unknown, status: "executed" | "failed") {
  // Le log d'audit ne doit jamais faire échouer l'outil lui-même : best-effort.
  try {
    await client.from("ai_action_log").insert({ user_id: userId, conversation_id: conversationId, agent_type: agentType, action_type: actionType, label, payload: payload as Json, status, executed_at: status === "executed" ? new Date().toISOString() : null });
  } catch (error) {
    console.error("[ai-chat] logAction impossible", { actionType, error });
  }
}

/**
 * Garantit qu'un outil ne peut JAMAIS terminer sans renvoyer de résultat, même en
 * cas d'exception imprévue (bug, timeout réseau, erreur inattendue) — c'est la
 * cause probable des erreurs "Tool result is missing". Logue systématiquement :
 * appel, paramètres, début, fin, durée, résultat ou erreur.
 */
function withToolLogging<Input, Output extends { ok: boolean; message: string }>(
  name: string,
  execute: (input: Input) => Promise<Output>,
): (input: Input) => Promise<Output> {
  return async (input: Input) => {
    const startedAt = Date.now();
    console.info("[ai-tool] appelé", { name, input });
    try {
      const output = await execute(input);
      console.info("[ai-tool] terminé", { name, ms: Date.now() - startedAt, ok: output.ok });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ai-tool] échec inattendu", { name, ms: Date.now() - startedAt, error: message });
      return { ok: false, message: `Action interrompue par une erreur inattendue : ${message}` } as Output;
    }
  };
}

function coachTools(client: Client, userId: string, conversationId: string, permissions: AiPermissions) {
  return {
    update_profile: tool({
      description: "Mettre à jour le poids, les objectifs ou les informations du profil Pace.",
      inputSchema: z.object({ weight_kg: z.number().nullable(), weight_goal_kg: z.number().nullable(), daily_calorie_goal: z.number().nullable(), daily_protein_goal: z.number().nullable(), daily_water_ml_goal: z.number().nullable(), training_goal: z.string().nullable() }),
      execute: withToolLogging("update_profile", async (input) => {
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
        if (error) { await logAction(client, userId, conversationId, "coach", "update_profile", "Mise à jour du profil", input, "failed"); return { ok: false, message: `Erreur base de données : ${error.message}` }; }
        await logAction(client, userId, conversationId, "coach", "update_profile", "Profil mis à jour", input, "executed");
        return { ok: true, message: "Profil mis à jour" };
      }),
    }),
    add_food: tool({
      description: "Ajouter un repas ou aliment au journal nutritionnel avec estimation complète des macros.",
      inputSchema: z.object({ name: z.string(), meal: z.string(), kcal: z.number(), protein_g: z.number(), carbs_g: z.number(), fat_g: z.number(), fiber_g: z.number(), sugar_g: z.number(), sodium_mg: z.number(), grams: z.number() }),
      execute: withToolLogging("add_food", async (input) => {
        if (!permissions.nutrition) return { ok: false, message: "Permission Nutrition désactivée" };
        const { error } = await client.from("food_log").insert({ user_id: userId, name: `${input.name} (${Math.round(input.grams)} g)`, meal: input.meal, kcal: input.kcal, protein_g: input.protein_g, carbs_g: input.carbs_g, fat_g: input.fat_g, fiber_g: input.fiber_g, sugar_g: input.sugar_g, sodium_mg: input.sodium_mg, source: "coach_ai" });
        if (error) { await logAction(client, userId, conversationId, "coach", "add_food", "Ajout nutrition", input, "failed"); return { ok: false, message: `Erreur base de données : ${error.message}` }; }
        await logAction(client, userId, conversationId, "coach", "add_food", `${input.name} ajouté`, input, "executed");
        return { ok: true, message: `${input.name} ajouté au journal` };
      }),
    }),
    add_health_sample: tool({
      description: "Enregistrer une mesure de santé comme le poids ou la masse grasse.",
      inputSchema: z.object({ type: z.string(), value: z.number() }),
      execute: withToolLogging("add_health_sample", async (input) => {
        if (!permissions.profile) return { ok: false, message: "Permission Profil désactivée" };
        const { error } = await client.from("health_samples").insert({ user_id: userId, type: input.type, value: input.value, source: "coach_ai" });
        if (error) { await logAction(client, userId, conversationId, "coach", "add_health_sample", "Mesure de santé", input, "failed"); return { ok: false, message: `Erreur base de données : ${error.message}` }; }
        await logAction(client, userId, conversationId, "coach", "add_health_sample", `${input.type} enregistré`, input, "executed");
        return { ok: true, message: "Mesure enregistrée" };
      }),
    }),
  };
}

function buildTools(client: Client, userId: string, conversationId: string) {
  return {
    create_development_task: tool({
      description: "Créer un bug, une amélioration, une fonctionnalité ou une tâche dans le centre Développement de Pace.",
      inputSchema: z.object({ kind: z.enum(["bug", "improvement", "feature", "task"]), title: z.string(), description: z.string(), priority: z.enum(["low", "medium", "high", "critical"]) }),
      execute: withToolLogging("create_development_task", async (input) => {
        const { error } = await client.from("development_tasks").insert({ ...input, user_id: userId, conversation_id: conversationId });
        if (error) { await logAction(client, userId, conversationId, "build", "create_development_task", "Création d’une tâche", input, "failed"); return { ok: false, message: `Erreur base de données : ${error.message}` }; }
        await logAction(client, userId, conversationId, "build", "create_development_task", `${input.kind} créé : ${input.title}`, input, "executed");
        return { ok: true, message: `${input.kind} créé dans Développement` };
      }),
    }),
  };
}

type Gateway = ReturnType<typeof createGoogleGenerativeAI>;

/**
 * Résumé glissant : les messages anciens (au-delà de la fenêtre récente) sont condensés
 * une seule fois puis réutilisés, ce qui permet des conversations quasi illimitées.
 */
async function rollingSummary(client: Client, userId: string, conversationId: string, gateway: Gateway) {
  const { data: conversation } = await client.from("ai_conversations").select("summary,summarized_count").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (!conversation) return "";
  const previous = conversation.summary ?? "";
  const done = conversation.summarized_count ?? 0;
  const { count } = await client.from("ai_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("user_id", userId);
  const total = count ?? 0;
  const target = total - RECENT_WINDOW;
  if (target <= done) return previous;

  const { data: rows, error } = await client.from("ai_messages").select("role,plain_text").eq("conversation_id", conversationId).eq("user_id", userId).order("created_at").range(done, target - 1);
  if (error || !rows?.length) return previous;
  const transcript = rows.map((row) => `${row.role === "user" ? "Utilisateur" : "Assistant"} : ${(row.plain_text ?? "").slice(0, 4000)}`).join("\n").slice(0, 120_000);

  try {
    const result = streamText({
      model: gateway("gemini-2.5-flash"),
      messages: [{ role: "user", content: `Voici un résumé existant d'une conversation puis de nouveaux échanges à intégrer. Produis un résumé fusionné en français, factuel et dense (800 mots maximum), qui conserve : objectifs, décisions, préférences, chiffres, actions réalisées et informations personnelles utiles. Réponds uniquement par le résumé.\n\n[RÉSUMÉ EXISTANT]\n${previous || "(aucun)"}\n\n[NOUVEAUX ÉCHANGES]\n${transcript}` }],
    });
    const summary = (await result.text).trim();
    if (!summary) return previous;
    await client.from("ai_conversations").update({ summary, summarized_count: target }).eq("id", conversationId).eq("user_id", userId);
    return summary;
  } catch (error) {
    console.error("[ai-chat] résumé impossible", error);
    return previous;
  }
}

/**
 * "Tool result is missing for tool call ..." — l'API rejette toute la requête si un
 * message envoyé au modèle contient un appel d'outil (tool-call) sans résultat
 * terminal associé (ex: l'utilisateur a rechargé la page ou changé de conversation
 * PENDANT une demande d'approbation, avant d'avoir cliqué Confirmer/Refuser).
 *
 * On garantit ici qu'aucun tool_call ne peut jamais partir sans réponse : tout
 * appel resté dans un état non terminal (en attente d'approbation, en cours de
 * saisie, etc.) reçoit un résultat synthétique avant d'être envoyé au modèle —
 * jamais d'exception, jamais de conversation bloquée.
 */
function closeDanglingToolCalls(messages: UIMessage[]): UIMessage[] {
  const TERMINAL_STATES = new Set(["output-available", "output-error"]);
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    let mutated = false;
    const parts = message.parts.map((part) => {
      const p = part as unknown as Record<string, unknown>;
      if (typeof p.type !== "string" || !p.type.startsWith("tool-")) return part;
      const state = typeof p.state === "string" ? p.state : "";
      if (TERMINAL_STATES.has(state)) return part;
      mutated = true;
      return {
        ...p,
        state: "output-error",
        errorText: "Action annulée (conversation interrompue avant confirmation) — sans effet, aucune donnée modifiée.",
      } as unknown as UIMessage["parts"][number];
    });
    return mutated ? { ...message, parts } : message;
  });
}

export async function handleAiChat(request: Request) {
  const startedAt = Date.now();
  try {
    let body: ChatBody;
    try {
      body = (await request.json()) as ChatBody;
    } catch {
      return fail(400, "invalid_json", "Requête illisible : le message n’a pas pu être transmis.");
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) fail(400, "no_messages", "Aucun message à envoyer.");
    if (typeof body.conversationId !== "string") fail(400, "no_conversation", "Conversation introuvable : ouvrez ou créez une conversation.");
    if (body.agentType !== "coach" && body.agentType !== "build") fail(400, "bad_agent", "Assistant inconnu.");

    const messages = body.messages as UIMessage[];
    const agentType = body.agentType;
    const ephemeral = body.ephemeral === true;
    const conversationId = body.conversationId;
    const newest = messages[messages.length - 1];
    if (newest && textOf(newest).length > MAX_TEXT_CHARS) fail(413, "message_too_long", `Message trop long : réduisez-le sous ${Math.round(MAX_TEXT_CHARS / 1000)} 000 caractères ou envoyez-le en plusieurs parties.`);

    const { client, userId } = await authenticatedClient(request);

    if (!ephemeral) {
      const { data, error } = await client.from("ai_conversations").select("id").eq("id", conversationId).eq("user_id", userId).eq("agent_type", agentType).maybeSingle();
      if (error) fail(503, "db_error", `Erreur base de données : ${error.message}`);
      if (!data) fail(404, "conversation_not_found", "Cette conversation n’existe plus. Créez-en une nouvelle.");
    }

    const key = apiKey();
    const google = createGoogleGenerativeAI({ apiKey: key });

    const preferences = await getPreferencesServer(client, userId);

    if (!ephemeral && newest?.role === "user") {
      const text = textOf(newest);
      const { data: exists } = await client.from("ai_messages").select("id").eq("conversation_id", conversationId).eq("model_message_id", newest.id).maybeSingle();
      if (!exists) {
        const { error } = await client.from("ai_messages").insert({ conversation_id: conversationId, user_id: userId, role: "user", parts: newest.parts as unknown as Json, plain_text: text, model_message_id: newest.id });
        if (error) fail(503, "db_write_error", `Votre message n’a pas pu être enregistré (${error.message}).`);
      }
    }

    const [dataContext, summary] = await Promise.all([
      agentType === "coach" ? contextForCoach(client, userId, preferences.permissions) : Promise.resolve({}),
      !ephemeral && preferences.memory_level !== "none" ? rollingSummary(client, userId, conversationId, google) : Promise.resolve(""),
    ]);

    const tools = agentType === "coach" ? coachTools(client, userId, conversationId, preferences.permissions) : buildTools(client, userId, conversationId);
    const memoryBlock = summary ? `\n\n[MÉMOIRE DE LA CONVERSATION — résumé des échanges plus anciens]\n${summary}` : "";
    const instructions = agentType === "coach"
      ? `Tu es Coach IA, le coach personnel francophone de Pace. Tu utilises automatiquement les données autorisées ci-dessous sans redemander ce qui est déjà connu. Tu donnes des réponses précises, bienveillantes et actionnables. Quand l'utilisateur demande une modification, utilise l'outil approprié. Après chaque outil, confirme clairement avec ✓ et la modification exacte. Données autorisées: ${JSON.stringify(dataContext)}. Niveau mémoire: ${preferences.memory_level}. Ne parle jamais du développement de Pace; redirige ces demandes vers BUILD IA.${memoryBlock}`
      : `Tu es BUILD IA, l'assistant de développement francophone de Pace. Tu transformes automatiquement les signalements en bugs, améliorations, fonctionnalités ou tâches structurées avec priorité. Tu n'es pas un coach santé et rediriges ces demandes vers Coach IA. Tu ne prétends jamais modifier le code source; tu peux analyser, cadrer et créer des éléments dans le centre Développement.${memoryBlock}`;

    const windowed = messages.length > RECENT_WINDOW ? messages.slice(-RECENT_WINDOW) : messages;
    const toolApproval = Object.fromEntries(Object.keys(tools).map((name) => [name, preferences.confirm_actions ? "user-approval" : "not-applicable"]));
    const safeWindowed = closeDanglingToolCalls(windowed);

    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: instructions,
      messages: await convertToModelMessages(safeWindowed),
      tools,
      toolApproval,
      stopWhen: stepCountIs(50),
      onError: ({ error }) => console.error("[ai-chat] erreur de flux", error),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      sendReasoning: true,
      headers: { "X-Pace-Prepare-Ms": String(Date.now() - startedAt) },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[ai-chat] erreur de génération", message);
        if (/rate.?limit|429/i.test(message)) return "Trop de requêtes vers l’IA : réessayez dans quelques instants.";
        if (/402|payment required/i.test(message)) return "Quota IA gratuit dépassé pour aujourd’hui : réessayez demain, ou passez sur un plan payant Gemini.";
        if (/timeout|aborted|network|fetch failed/i.test(message)) return "Connexion à l’IA interrompue : votre message est conservé, réessayez.";
        return `Erreur de l’IA : ${message}`;
      },
      onFinish: async ({ responseMessage }) => {
        if (ephemeral) return;
        try {
          const text = responseMessage.parts.filter((part) => part.type === "text").map((part) => ("text" in part ? part.text : "")).join("\n");
          const { error } = await client.from("ai_messages").insert({ conversation_id: conversationId, user_id: userId, role: "assistant", parts: responseMessage.parts as unknown as Json, plain_text: text, model_message_id: responseMessage.id });
          if (error) console.error("[ai-chat] sauvegarde assistant impossible", error.message);
          await client.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", userId);
          const { data: conversation } = await client.from("ai_conversations").select("title").eq("id", conversationId).maybeSingle();
          if (conversation?.title === "Nouvelle conversation") {
            const firstText = messages.flatMap((message) => message.parts).find((part) => part.type === "text");
            if (firstText && firstText.type === "text") await client.from("ai_conversations").update({ title: firstText.text.trim().replace(/\s+/g, " ").slice(0, 52) }).eq("id", conversationId).eq("user_id", userId);
          }
          console.info("[ai-chat] terminé", { conversationId, agentType, ms: Date.now() - startedAt });
        } catch (error) {
          console.error("[ai-chat] post-traitement échoué", error);
        }
      },
    });
  } catch (error) {
    return errorResponse(error, startedAt);
  }
}
