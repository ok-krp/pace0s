import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

function getAuthClient(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return null;
  return { client: createClient<Database>(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }), token };
}

async function persistAssistantMessage(request: Request, conversationId: string, messageId: string, text: string) {
  const normalized = text.trim();
  if (!normalized) return;
  const auth = getAuthClient(request);
  if (!auth) return;
  const { data: userData, error: userError } = await auth.client.auth.getUser(auth.token);
  const userId = userData.user?.id;
  if (userError || !userId) return;

  const parts = [{ type: "text", text: normalized }] as unknown as Json;
  const { data: existing, error: lookupError } = await auth.client.from("ai_messages").select("id").eq("conversation_id", conversationId).eq("user_id", userId).eq("model_message_id", messageId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return;

  const { error: insertError } = await auth.client.from("ai_messages").insert({ conversation_id: conversationId, user_id: userId, role: "assistant", parts, plain_text: normalized, model_message_id: messageId });
  if (insertError) throw insertError;

  const { error: conversationError } = await auth.client.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", userId);
  if (conversationError) throw conversationError;
}

/** Forward the UI Message SSE stream and persist the assistant at the AI SDK finish frame. */
export function persistAssistantFromUIStream(request: Request, response: Response, conversationId: string) {
  if (!response.body || !conversationId) return response;

  const decoder = new TextDecoder();
  let buffer = "";
  let messageId = "";
  let text = "";
  let persisted = false;

  const persistCompleted = async () => {
    if (persisted || !text.trim()) return;
    persisted = true;
    if (!messageId) messageId = `pace-${crypto.randomUUID()}`;
    try {
      await persistAssistantMessage(request, conversationId, messageId, text);
    } catch (error) {
      persisted = false;
      console.error("[ai-chat] assistant persistence failed", error instanceof Error ? error.message : "unknown");
    }
  };

  const parseEvent = async (event: string) => {
    const dataLines = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    if (raw === "[DONE]") { await persistCompleted(); return; }
    try {
      const part = JSON.parse(raw) as { type?: string; messageId?: string; id?: string; delta?: string };
      if ((part.type === "start" || part.type === "start-step") && (part.messageId || part.id)) messageId = part.messageId ?? part.id ?? "";
      if (part.type === "text-delta" && typeof part.delta === "string") text += part.delta;
      if (part.type === "finish") await persistCompleted();
    } catch {
      // Ignore non-JSON SSE frames while forwarding them unchanged.
    }
  };

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) await parseEvent(event);
    },
    async flush() {
      buffer += decoder.decode();
      if (buffer.trim()) await parseEvent(buffer);
      await persistCompleted();
    },
  });

  response.body.pipeTo(stream.writable).catch((error) => {
    console.error("[ai-chat] assistant stream forwarding failed", error instanceof Error ? error.message : "unknown");
  });

  return new Response(stream.readable, { status: response.status, statusText: response.statusText, headers: response.headers });
}
