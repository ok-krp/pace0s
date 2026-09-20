import { createFileRoute } from "@tanstack/react-router";
import { handleAiChat } from "@/lib/ai-chat.server";

export const Route = createFileRoute("/api/ai-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => handleAiChat(request),
    },
  },
});
