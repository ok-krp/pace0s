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
  if (!text.trim()) return;
  const auth = getAuthClient(request);
  if (!auth) return;
  const { data: userData, error: userError } = await auth.client.auth.getUser(auth.token);
  const userId = userData.user?.id;
  if (userError || !userId) return;

  const parts = [{ type: "text", text }] as unknown as Json;
  const { data: existing, error: lookupError } = await auth.client
    .from("ai_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .eq("model_message_id", messageId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return;

  const { error: insertError } = await auth.client.from("ai_messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    parts,
    plain_text: text,
    model_message_id: messageId,
  });
  if (insertError) throw insertError;

  const { error: conversationError } = await auth.client
    .from("ai_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (conversationError) throw conversationError;
}

/**
 * Persist the completed assistant UI stream before closing the response.
 *
 * The previous implementation used response.body.tee() and a fire-and-forget
 * task. On Vercel/Nitro that task could be terminated as soon as the HTTP
 * response finished, leaving the assistant message visible in the current UI
 * but absent after a refresh. The TransformStream keeps the response streaming
 * while making persistence part of the stream lifecycle and waits for the DB
 * write before the response is considered complete.
 */
export function persistAssistantFromUIStream(request: Request, response: Response, conversationId: string) {
  if (!response.body || !conversationId) return response;

  const decoder = new TextDecoder();
  let buffer = "";
  let messageId = "";
  let text = "";

  const parseEvent = (event: string) => {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (!dataLines.length) return;

    const raw = dataLines.join("\n");
    if (raw === "[DONE]") return;

    try {
      const part = JSON.parse(raw) as {
        type?: string;
        messageId?: string;
        id?: string;
        delta?: string;
      };
      if ((part.type === "start" || part.type === "start-step") && (part.messageId || part.id)) {
        messageId = part.messageId ?? part.id ?? "";
      }
      if (part.type === "text-delta" && typeof part.delta === "string") {
        text += part.delta;
      }
    } catch {
      // Ignore non-JSON SSE frames; the client still receives them unchanged.
    }
  };

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) parseEvent(event);
    },
    async flush() {
      buffer += decoder.decode();
      if (buffer.trim()) parseEvent(buffer);
      if (!text.trim()) return;
      if (!messageId) messageId = `pace-${crypto.randomUUID()}`;

      try {
        await persistAssistantMessage(request, conversationId, messageId, text);
      } catch (error) {
        console.error("[ai-chat] assistant persistence failed", error instanceof Error ? error.message : "unknown");
      }
    },
  });

  response.body.pipeTo(stream.writable).catch((error) => {
    console.error("[ai-chat] assistant stream forwarding failed", error instanceof Error ? error.message : "unknown");
  });

  return new Response(stream.readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
