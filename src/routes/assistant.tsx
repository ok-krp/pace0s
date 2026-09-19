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
  return <div className="min-h-[50vh] grid place-items-center"><div className="w-full max-w-3xl glass-card rounded-[24px] p-4 sm:p-6"><div className="flex items-center gap-3 overflow-x-auto scrollbar-none"><div className="flex shrink-0 rounded-xl glass-thin p-1"><div className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium whitespace-nowrap">Coach IA</div><div className="rounded-lg px-3 py-2 text-sm text-muted-foreground whitespace-nowrap">BUILD IA</div></div><div className="ml-auto shrink-0 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" />Ouverture de l’assistant…</div></div><div className="mt-6 space-y-3"><div className="h-4 w-40 rounded-full bg-muted/50 animate-pulse" /><div className="h-20 rounded-2xl bg-muted/30 animate-pulse" /><div className="h-11 rounded-2xl bg-muted/30 animate-pulse" /></div></div></div>;
}