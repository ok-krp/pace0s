import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { DEFAULT_AI_PERMISSIONS, type AgentType, type AiPermissions, type AiPreferences } from "./ai-history.types";

type Client = SupabaseClient<Database>;

export async function listConversationsServer(client: Client, userId: string, agentType: AgentType) {
  const { data, error } = await client.from("ai_conversations").select("id,agent_type,title,is_starred,is_archived,is_ephemeral,updated_at").eq("user_id", userId).eq("agent_type", agentType).eq("is_ephemeral", false).order("is_starred", { ascending: false }).order("updated_at", { ascending: false });
  if (error) { console.error("AI conversation list failed", error); throw new Error("Impossible de charger les conversations IA."); }
  return data;
}

export async function createConversationServer(client: Client, userId: string, agentType: AgentType) {
  const { data, error } = await client.from("ai_conversations").insert({ user_id: userId, agent_type: agentType }).select("id,agent_type,title,is_starred,is_archived,is_ephemeral,updated_at").single();
  if (error) { console.error("AI conversation creation failed", error); throw new Error("Impossible de créer la conversation IA."); }
  return data;
}

export async function getConversationServer(client: Client, userId: string, id: string, agentType: AgentType) {
  const { data: conversation, error } = await client.from("ai_conversations").select("id,agent_type,title,is_starred,is_archived,is_ephemeral,updated_at").eq("id", id).eq("user_id", userId).eq("agent_type", agentType).maybeSingle();
  if (error) { console.error("AI conversation read failed", error); throw new Error("Impossible de charger la conversation IA."); }
  if (!conversation) return null;
  const { data: rows, error: messageError } = await client.from("ai_messages").select("id,role,parts").eq("conversation_id", id).eq("user_id", userId).order("created_at");
  if (messageError) { console.error("AI messages read failed", messageError); throw new Error("Impossible de charger les messages IA."); }
  const messages = rows.map((row) => ({ id: row.id, role: row.role, parts: row.parts }));
  return { conversation, messages };
}

export async function updateConversationServer(client: Client, userId: string, id: string, patch: { title?: string; is_starred?: boolean; is_archived?: boolean }) {
  const { error } = await client.from("ai_conversations").update(patch).eq("id", id).eq("user_id", userId);
  if (error) { console.error("AI conversation update failed", error); throw new Error("Impossible de modifier la conversation IA."); }
  return { ok: true };
}

export async function deleteConversationServer(client: Client, userId: string, id: string) {
  const { error } = await client.from("ai_conversations").delete().eq("id", id).eq("user_id", userId);
  if (error) { console.error("AI conversation deletion failed", error); throw new Error("Impossible de supprimer la conversation IA."); }
  return { ok: true };
}

export async function getPreferencesServer(client: Client, userId: string): Promise<AiPreferences> {
  const { data, error } = await client.from("ai_preferences").select("memory_level,permissions,confirm_actions").eq("user_id", userId).maybeSingle();
  if (error) { console.error("AI preferences read failed", error); throw new Error("Impossible de charger les préférences IA."); }
  if (!data) return { memory_level: "limited", permissions: DEFAULT_AI_PERMISSIONS, confirm_actions: true };
  return {
    memory_level: data.memory_level as AiPreferences["memory_level"],
    permissions: { ...DEFAULT_AI_PERMISSIONS, ...(data.permissions as Partial<AiPermissions>) },
    confirm_actions: data.confirm_actions,
  };
}

export async function savePreferencesServer(client: Client, userId: string, preferences: AiPreferences) {
  const { error } = await client.from("ai_preferences").upsert({ user_id: userId, memory_level: preferences.memory_level, permissions: preferences.permissions as unknown as Json, confirm_actions: preferences.confirm_actions });
  if (error) { console.error("AI preferences save failed", error); throw new Error("Impossible d’enregistrer les préférences IA."); }
  return preferences;
}
