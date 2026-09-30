import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { createAiConversation, listAiConversations } from "@/lib/ai-history.functions";

export const Route = createFileRoute("/assistant")({
  head: () => ({ meta: [{ title: "Intelligence Artificielle — Pace" }, { name: "description", content: "Accédez à Coach IA dans Pace." }, { property: "og:title", content: "Intelligence Artificielle — Pace" }, { property: "og:description", content: "Accédez à Coach IA dans Pace." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
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
  return <main className="min-h-[60vh] grid place-items-center" aria-busy="true"><div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" /><span>Ouverture de Coach IA…</span></div></main>;
}