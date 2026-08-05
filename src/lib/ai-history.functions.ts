import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createConversationServer, deleteConversationServer, getConversationServer, getPreferencesServer, listConversationsServer, savePreferencesServer, updateConversationServer } from "./ai-history.server";

export const listAiConversations = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ agentType: z.enum(["coach", "build"]) }).parse(data)).handler(({ data, context }) => listConversationsServer(context.supabase, context.userId, data.agentType));

export const createAiConversation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ agentType: z.enum(["coach", "build"]) }).parse(data)).handler(({ data, context }) => createConversationServer(context.supabase, context.userId, data.agentType));

export const getAiConversation = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ id: z.string().uuid(), agentType: z.enum(["coach", "build"]) }).parse(data)).handler(({ data, context }) => getConversationServer(context.supabase, context.userId, data.id, data.agentType));

export const updateAiConversation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ id: z.string().uuid(), title: z.string().max(80).optional(), isStarred: z.boolean().optional(), isArchived: z.boolean().optional() }).parse(data)).handler(({ data, context }) => updateConversationServer(context.supabase, context.userId, data.id, { ...(data.title === undefined ? {} : { title: data.title }), ...(data.isStarred === undefined ? {} : { is_starred: data.isStarred }), ...(data.isArchived === undefined ? {} : { is_archived: data.isArchived }) }));

export const deleteAiConversation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data)).handler(({ data, context }) => deleteConversationServer(context.supabase, context.userId, data.id));

export const getAiPreferences = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(({ context }) => getPreferencesServer(context.supabase, context.userId));

export const saveAiPreferences = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: unknown) => z.object({ memory_level: z.enum(["none", "limited", "complete"]), permissions: z.record(z.boolean()), confirm_actions: z.boolean() }).parse(data)).handler(({ data, context }) => savePreferencesServer(context.supabase, context.userId, data as Parameters<typeof savePreferencesServer>[2]));