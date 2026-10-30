import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { getPreferencesServer } from "./ai-history.server";
import type { AgentType, AiPermissions } from "./ai-history.types";
import { LEGAL_VERSIONS } from "./legal";

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
  // Unexpected provider/database errors can contain SQL details or user data.
  // Keep the client response and platform logs free of those internal messages.
  const message = known
    ? error.message
    : "Une erreur interne est survenue. Réessayez dans quelques instants.";
  console.error("[ai-chat] échec", {
    code,
    status,
    ms: Date.now() - startedAt,
    errorType: error instanceof Error ? error.name : "unknown",
  });
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
  return message.parts
    .filter((part) => part !== null && typeof part === "object" && part.type === "text")
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n");
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

async function logAction(
  client: Client,
  userId: string,
  conversationId: string,
  agentType: AgentType,
  actionType: string,
  _label: string,
  _payload: unknown,
  status: "executed" | "failed",
) {
  // Audit metadata must not duplicate profile, health, nutrition, or task content.
  // Keep a stable action label and an empty payload; the source tables remain canonical.
  const safeLabels: Record<string, string> = {
    update_profile: "Mise à jour du profil",
    add_food: "Ajout nutrition",
    add_health_sample: "Enregistrement santé",
    create_development_task: "Création tâche développement",
  };
  try {
    await client.from("ai_action_log").insert({
      user_id: userId,
      conversation_id: conversationId,
      agent_type: agentType,
      action_type: actionType,
      label: safeLabels[actionType] ?? "Action IA",
      payload: {} as Json,
      status,
      executed_at: status === "executed" ? new Date().toISOString() : null,
    });
  } catch (error) {
    console.error("[ai-chat] logAction impossible", {
      actionType,
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
}

/**
 * Garantit qu'un outil ne peut JAMAIS terminer sans renvoyer de résultat, même en
 * cas d'exception imprévue (bug, timeout réseau, erreur inattendue) — c'est la
 * cause probable des erreurs "Tool result is missing". Logue systématiquement :
 * appel, début, fin et statut — sans enregistrer les paramètres personnels.
 */
function withToolLogging<Input, Output extends { ok: boolean; message: string }>(
  name: string,
  execute: (input: Input) => Promise<Output>,
): (input: Input) => Promise<Output> {
  return async (input: Input) => {
    const startedAt = Date.now();
    // Tool inputs may contain health, nutrition, profile, or personal notes.
    // Never write raw tool arguments or exception messages to platform logs.
    console.info("[ai-tool] appelé", { name });
    try {
      const output = await execute(input);
      console.info("[ai-tool] terminé", { name, ms: Date.now() - startedAt, ok: output.ok });
      return output;
    } catch (error) {
      console.error("[ai-tool] échec inattendu", {
        name,
        ms: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return {
        ok: false,
        message: "Action interrompue par une erreur inattendue. Réessayez.",
      } as Output;
    }
  };
}

function coachTools(client: Client, userId: string, conversationId: string, permissions: AiPermissions) {
  return {
    update_profile: tool({
      description: "Mettre à jour le poids, les objectifs ou les informations du profil Pace.",
      inputSchema: z.object({
        weight_kg: z.number().finite().positive().nullable(),
        weight_goal_kg: z.number().finite().positive().nullable(),
        daily_calorie_goal: z.number().finite().positive().nullable(),
        daily_protein_goal: z.number().finite().positive().nullable(),
        daily_water_ml_goal: z.number().finite().positive().nullable(),
        training_goal: z.string().trim().max(160).nullable(),
      }),
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
        if (error) { await logAction(client, userId, conversationId, "coach", "update_profile", "Mise à jour du profil", input, "failed"); return { ok: false, message: "Impossible de mettre à jour le profil. Réessayez." }; }
        await logAction(client, userId, conversationId, "coach", "update_profile", "Profil mis à jour", input, "executed");
        return { ok: true, message: "Profil mis à jour" };
      }),
    }),
    add_food: tool({
      description: "Ajouter un repas ou aliment au journal nutritionnel avec estimation complète des macros.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200),
        meal: z.string().trim().min(1).max(40),
        kcal: z.number().finite().nonnegative(),
        protein_g: z.number().finite().nonnegative(),
        carbs_g: z.number().finite().nonnegative(),
        fat_g: z.number().finite().nonnegative(),
        fiber_g: z.number().finite().nonnegative(),
        sugar_g: z.number().finite().nonnegative(),
        sodium_mg: z.number().finite().nonnegative(),
        grams: z.number().finite().positive(),
      }),
      execute: withToolLogging("add_food", async (input) => {
        if (!permissions.nutrition) return { ok: false, message: "Permission Nutrition désactivée" };
        const { error } = await client.from("food_log").insert({ user_id: userId, name: `${input.name} (${Math.round(input.grams)} g)`, meal: input.meal, kcal: input.kcal, protein_g: input.protein_g, carbs_g: input.carbs_g, fat_g: input.fat_g, fiber_g: input.fiber_g, sugar_g: input.sugar_g, sodium_mg: input.sodium_mg, source: "coach_ai" });
        if (error) { await logAction(client, userId, conversationId, "coach", "add_food", "Ajout nutrition", input, "failed"); return { ok: false, message: "Impossible d’enregistrer cet aliment. Réessayez." }; }
        await logAction(client, userId, conversationId, "coach", "add_food", `${input.name} ajouté`, input, "executed");
        return { ok: true, message: `${input.name} ajouté au journal` };
      }),
    }),
    add_health_sample: tool({
      description: "Enregistrer une mesure de santé comme le poids ou la masse grasse.",
      inputSchema: z.object({ type: z.string().trim().min(1).max(60), value: z.number().finite().nonnegative() }),
      execute: withToolLogging("add_health_sample", async (input) => {
        if (!permissions.profile) return { ok: false, message: "Permission Profil désactivée" };
        const { error } = await client.from("health_samples").insert({ user_id: userId, type: input.type, value: input.value, source: "coach_ai" });
        if (error) { await logAction(client, userId, conversationId, "coach", "add_health_sample", "Mesure de santé", input, "failed"); return { ok: false, message: "Impossible d’enregistrer cette mesure. Réessayez." }; }
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
        if (error) { await logAction(client, userId, conversationId, "build", "create_development_task", "Création d’une tâche", input, "failed"); return { ok: false, message: "Impossible de créer cette tâche. Réessayez." }; }
        await logAction(client, userId, conversationId, "build", "create_development_task", `${input.kind} créé : ${input.title}`, input, "executed");
        return { ok: true, message: `${input.kind} créé dans Développement` };
      }),
    }),
  };
}

type Gateway = ReturnType<typeof createOpenAICompatible>;

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
      model: gateway.chatModel("gemini-2.5-flash"),
      messages: [{ role: "user", content: `Voici un résumé existant d'une conversation puis de nouveaux échanges à intégrer. Produis un résumé fusionné en français, factuel et dense (800 mots maximum), qui conserve : objectifs, décisions, préférences, chiffres, actions réalisées et informations personnelles utiles. Réponds uniquement par le résumé.\n\n[RÉSUMÉ EXISTANT]\n${previous || "(aucun)"}\n\n[NOUVEAUX ÉCHANGES]\n${transcript}` }],
    });
    const summary = (await result.text).trim();
    if (!summary) return previous;
    await client.from("ai_conversations").update({ summary, summarized_count: target }).eq("id", conversationId).eq("user_id", userId);
    return summary;
  } catch (error) {
    console.error("[ai-chat] résumé impossible", { errorType: error instanceof Error ? error.name : "unknown" });
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
    const hasMalformedMessage = messages.some(
      (message) =>
        !message ||
        typeof message !== "object" ||
        typeof message.id !== "string" ||
        message.id.length === 0 ||
        (message.role !== "user" && message.role !== "assistant") ||
        !Array.isArray(message.parts),
    );
    if (hasMalformedMessage) {
      fail(400, "invalid_messages", "Le format de la conversation est invalide. Rechargez-la puis réessayez.");
    }
    const agentType = body.agentType;
    const ephemeral = body.ephemeral === true;
    const conversationId = body.conversationId;
    const newest = messages[messages.length - 1];
    const windowed = messages.length > RECENT_WINDOW ? messages.slice(-RECENT_WINDOW) : messages;
    const contextTextChars = windowed.reduce((total, message) => total + textOf(message).length, 0);
    if (contextTextChars > MAX_TEXT_CHARS) {
      fail(413, "context_too_long", `Le contexte envoyé à l’IA dépasse ${MAX_TEXT_CHARS.toLocaleString("fr-FR")} caractères. Réduisez les messages récents ou envoyez-les en plusieurs parties.`);
    }

    const { client, userId } = await authenticatedClient(request);

    // An authenticated session is not, by itself, consent to send conversation
    // content to an external AI provider. Enforce the current legal decision
    // on the server for both persisted and ephemeral conversations.
    const { data: consent, error: consentError } = await client
      .from("legal_consent")
      .select("opts")
      .eq("user_id", userId)
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (consentError) {
      fail(503, "consent_lookup_failed", "Impossible de vérifier le consentement IA. Réessayez.");
    }
    const consentOptions = consent?.opts as { ai?: unknown } | null;
    if (consentOptions?.ai !== true) {
      fail(403, "ai_consent_required", "Activez le consentement Analyse IA dans Paramètres → Confidentialité.");
    }

    if (!ephemeral) {
      const { data, error } = await client.from("ai_conversations").select("id").eq("id", conversationId).eq("user_id", userId).eq("agent_type", agentType).maybeSingle();
      if (error) fail(503, "db_error", "Le service IA est temporairement indisponible. Réessayez.");
      if (!data) fail(404, "conversation_not_found", "Cette conversation n’existe plus. Créez-en une nouvelle.");
    }

    const key = apiKey();
    const google = createOpenAICompatible({
      name: "google",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: key,
    });

    const preferences = await getPreferencesServer(client, userId);

    if (!ephemeral && newest?.role === "user") {
      const text = textOf(newest);
      const { data: exists } = await client.from("ai_messages").select("id").eq("conversation_id", conversationId).eq("user_id", userId).eq("model_message_id", newest.id).maybeSingle();
      if (!exists) {
        const { error } = await client.from("ai_messages").insert({ conversation_id: conversationId, user_id: userId, role: "user", parts: newest.parts as unknown as Json, plain_text: text, model_message_id: newest.id });
        if (error) fail(503, "db_write_error", "Votre message n’a pas pu être enregistré. Réessayez.");
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

    const toolApproval = Object.fromEntries(Object.keys(tools).map((name) => [name, preferences.confirm_actions ? "user-approval" : "not-applicable"]));
    const safeWindowed = closeDanglingToolCalls(windowed);

    const result = streamText({
      model: google.chatModel("gemini-2.5-flash"),
      system: instructions,
      messages: await convertToModelMessages(safeWindowed),
      tools,
      toolApproval,
      stopWhen: stepCountIs(50),
      onError: ({ error }) => console.error("[ai-chat] erreur de flux", { errorType: error instanceof Error ? error.name : "unknown" }),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      sendReasoning: true,
      headers: { "X-Pace-Prepare-Ms": String(Date.now() - startedAt) },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[ai-chat] erreur de génération", { errorType: error instanceof Error ? error.name : "unknown" });
        if (/rate.?limit|429/i.test(message)) return "Trop de requêtes vers l’IA : réessayez dans quelques instants.";
        if (/402|payment required/i.test(message)) return "Quota IA gratuit dépassé pour aujourd’hui : réessayez demain, ou passez sur un plan payant Gemini.";
        if (/timeout|aborted|network|fetch failed/i.test(message)) return "Connexion à l’IA interrompue : votre message est conservé, réessayez.";
        return "Le service IA a rencontré une erreur. Réessayez dans quelques instants.";
      },
      onFinish: async ({ responseMessage }) => {
        if (ephemeral) return;
        try {
          const text = responseMessage.parts.filter((part) => part.type === "text").map((part) => ("text" in part ? part.text : "")).join("\n");
          const { error } = await client.from("ai_messages").insert({ conversation_id: conversationId, user_id: userId, role: "assistant", parts: responseMessage.parts as unknown as Json, plain_text: text, model_message_id: responseMessage.id });
          if (error) console.error("[ai-chat] sauvegarde assistant impossible", { code: error.code ?? "unknown" });
          await client.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", userId);
          const { data: conversation } = await client.from("ai_conversations").select("title").eq("id", conversationId).eq("user_id", userId).maybeSingle();
          if (conversation?.title === "Nouvelle conversation") {
            const firstText = messages.flatMap((message) => message.parts).find((part) => part.type === "text");
            if (firstText && firstText.type === "text") await client.from("ai_conversations").update({ title: firstText.text.trim().replace(/\s+/g, " ").slice(0, 52) }).eq("id", conversationId).eq("user_id", userId);
          }
          console.info("[ai-chat] terminé", { conversationId, agentType, ms: Date.now() - startedAt });
        } catch (error) {
          console.error("[ai-chat] post-traitement échoué", { errorType: error instanceof Error ? error.name : "unknown" });
        }
      },
    });
  } catch (error) {
    return errorResponse(error, startedAt);
  }
}
