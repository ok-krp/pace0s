import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { createAiConversation, listAiConversations } from "@/lib/ai-history.functions";

export const Route = createFileRoute("/assistant")({
  head: () => ({ meta: [{ title: "Intelligence Artificielle — Pace" }, { name: "description", content: "Accédez à Coach IA et BUILD IA dans Pace." }, { property: "og:title", content: "Intelligence Artificielle — Pace" }, { property: "og:description", content: "Deux assistants spécialisés pour votre suivi et le développement de Pace." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: AssistantEntry,
});

function AssistantEntry() {
  const navigate = useNavigate();
  const list = useServerFn(listAiConversations);
  const create = useServerFn(createAiConversation);
  useEffect(() => {
    void (async () => {
      const conversations = await list({ data: { agentType: "coach" } });
      const conversation = conversations[0] ?? await create({ data: { agentType: "coach" } });
      await navigate({ to: "/ai/$agentType/$conversationId", params: { agentType: "coach", conversationId: conversation.id }, replace: true });
    })();
  }, [create, list, navigate]);
  return <div className="min-h-[50vh] grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
}