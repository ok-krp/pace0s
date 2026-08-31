import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createConversationServer, deleteConversationServer, getConversationServer, getPreferencesServer, listConversationsServer, savePreferencesServer, updateConversationServer } from "./ai-history.server";
import { deleteAiProviderKey, getAiProviderSettings as getAiProviderSettingsServer, listAiProviderModels, saveAiProviderSettings, testAiProvider } from "./ai-provider.server";
import type { AiProvider } from "./ai-history.types";

const providerSchema = z.enum(["openai", "anthropic", "gemini", "openrouter", "custom"]);
export const BUILD_ADMIN_EMAIL = "mathieu.lequint@gmail.com";

type AuthClaims = { email?: unknown };
function assertBuildAccess(agentType: "coach" | "build", claims: unknown) {
  if (agentType !== "build") return;
  const email = typeof claims === "object" && claims !== null && "email" in claims ? String((claims as AuthClaims).email ?? "").trim().toLowerCase() : "";
  if (email !== BUILD_ADMIN_EMAIL) throw new Error("BUILD IA est réservé au compte administrateur autorisé.");
}

export const listAiConversations = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ agentType: z.enum(["coach", "build"]) }).parse(data)).handler(({ data, context }) => { assertBuildAccess(data.agentType, context.claims); return listConversationsServer(context.supabase, context.userId, data.agentType); });
export const createAiConversation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ agentType: z.enum(["coach", "build"]) }).parse(data)).handler(({ data, context }) => { assertBuildAccess(data.agentType, context.claims); return createConversationServer(context.supabase, context.userId, data.agentType); });
export const getAiConversation = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ id: z.string().uuid(), agentType: z.enum(["coach", "build"]) }).parse(data)).handler(({ data, context }) => { assertBuildAccess(data.agentType, context.claims); return getConversationServer(context.supabase, context.userId, data.id, data.agentType); });
export const updateAiConversation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ id: z.string().uuid(), title: z.string().max(80).optional(), isStarred: z.boolean().optional(), isArchived: z.boolean().optional(), agentType: z.enum(["coach", "build"]).optional() }).parse(data)).handler(({ data, context }) => { assertBuildAccess(data.agentType ?? "coach", context.claims); return updateConversationServer(context.supabase, context.userId, data.id, { ...(data.title === undefined ? {} : { title: data.title }), ...(data.isStarred === undefined ? {} : { is_starred: data.isStarred }), ...(data.isArchived === undefined ? {} : { is_archived: data.isArchived }) }); });
export const deleteAiConversation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ id: z.string().uuid(), agentType: z.enum(["coach", "build"]).optional() }).parse(data)).handler(({ data, context }) => { assertBuildAccess(data.agentType ?? "coach", context.claims); return deleteConversationServer(context.supabase, context.userId, data.id); });
export const getAiPreferences = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(({ context }) => getPreferencesServer(context.supabase, context.userId));
export const saveAiPreferences = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ memory_level: z.enum(["none", "limited", "complete"]), permissions: z.record(z.boolean()), confirm_actions: z.boolean() }).parse(data)).handler(({ data, context }) => savePreferencesServer(context.supabase, context.userId, data as Parameters<typeof savePreferencesServer>[2]));
export const getAiProviderSettings = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const settings = await getAiProviderSettingsServer(context.supabase, context.userId);
  const claims = context.claims;
  const email = typeof claims === "object" && claims !== null && "email" in claims ? String((claims as AuthClaims).email ?? "").trim().toLowerCase() : "";
  if (email === BUILD_ADMIN_EMAIL) return settings;
  return { ...settings, build: { ...settings.build, source: "pace" as const, provider: "gemini" as const, model: "gemini-3.6-flash", baseUrl: "", keyConfigured: false, keyLast4: "" } };
});
export const saveAiProviderSettingsFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ agentType: z.enum(["coach", "build"]), source: z.enum(["pace", "byok"]), provider: providerSchema, model: z.string().max(200), baseUrl: z.string().max(500).nullable().optional(), apiKey: z.string().max(1000).nullable().optional() }).parse(data)).handler(({ data, context }) => { assertBuildAccess(data.agentType, context.claims); return saveAiProviderSettings(context.supabase, context.userId, data); });
export const deleteAiProviderKeyFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ provider: providerSchema }).parse(data)).handler(({ data, context }) => deleteAiProviderKey(context.supabase, context.userId, data.provider as AiProvider));
export const testAiProviderFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ provider: providerSchema, model: z.string().max(200), baseUrl: z.string().max(500).nullable().optional(), apiKey: z.string().max(1000).nullable().optional() }).parse(data)).handler(({ data, context }) => testAiProvider(context.supabase, context.userId, data));
export const listAiProviderModelsFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ provider: providerSchema, baseUrl: z.string().max(500).nullable().optional(), apiKey: z.string().max(1000).nullable().optional() }).parse(data)).handler(({ data, context }) => listAiProviderModels(context.supabase, context.userId, data));
