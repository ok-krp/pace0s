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
  const { data: existing } = await auth.client.from("ai_messages").select("id").eq("conversation_id", conversationId).eq("model_message_id", messageId).maybeSingle();
  if (existing) return;
  await auth.client.from("ai_messages").insert({ conversation_id: conversationId, user_id: userId, role: "assistant", parts, plain_text: text, model_message_id: messageId });
  await auth.client.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", userId);
}

export async function persistAssistantFromUIStream(request: Request, response: Response, conversationId: string) {
  if (!response.body || !conversationId) return response;
  const [clientStream, auditStream] = response.body.tee();
  void (async () => {
    const reader = auditStream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let messageId = "";
    let text = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n/);
        buffer = events.pop() ?? "";
        for (const event of events) {
          const dataLine = event.split(/\n/).find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const raw = dataLine.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            const part = JSON.parse(raw) as { type?: string; messageId?: string; delta?: string };
            if (part.type === "start" && part.messageId) messageId = part.messageId;
            if (part.type === "text-delta" && typeof part.delta === "string") text += part.delta;
            if (part.type === "finish" && messageId) await persistAssistantMessage(request, conversationId, messageId, text);
          } catch { /* Ignore malformed/non-JSON stream lines. */ }
        }
      }
      if (messageId) await persistAssistantMessage(request, conversationId, messageId, text);
    } catch (error) {
      console.error("[ai-chat] assistant persistence failed", error instanceof Error ? error.message : "unknown");
    } finally {
      reader.releaseLock();
    }
  })();
  return new Response(clientStream, { status: response.status, statusText: response.statusText, headers: response.headers });
}
