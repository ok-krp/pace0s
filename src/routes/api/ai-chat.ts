import { createFileRoute } from "@tanstack/react-router";
import { handleAiChat } from "@/lib/ai-chat.server";
import { persistAssistantFromUIStream } from "@/lib/ai-chat-persistence.server";

export const Route = createFileRoute("/api/ai-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.clone().json().catch(() => ({}))) as { conversationId?: unknown; ephemeral?: unknown };
        const response = await handleAiChat(request);
        if (body.ephemeral === true || typeof body.conversationId !== "string") return response;
        return persistAssistantFromUIStream(request, response, body.conversationId);
      },
    },
  },
});
