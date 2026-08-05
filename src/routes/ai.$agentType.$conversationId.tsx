import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Archive, Bot, Brain, Check, ChevronRight, Clock3, Code2, History, Loader2, Menu, MoreHorizontal, Plus, Send, Sparkles, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { createAiConversation, deleteAiConversation, getAiConversation, listAiConversations, updateAiConversation } from "@/lib/ai-history.functions";
import type { AgentType, AiConversation } from "@/lib/ai-history.types";

export const Route = createFileRoute("/ai/$agentType/$conversationId")({
  params: { parse: (params) => ({ agentType: params.agentType === "build" ? "build" as const : "coach" as const, conversationId: params.conversationId }) },
  head: ({ params }) => ({ meta: [{ title: `${params.agentType === "build" ? "BUILD IA" : "Coach IA"} — Pace` }, { name: "description", content: "Assistant intelligent Pace avec historique synchronisé et actions transparentes." }, { property: "og:title", content: `${params.agentType === "build" ? "BUILD IA" : "Coach IA"} — Pace` }, { property: "og:description", content: "Assistant intelligent Pace avec historique synchronisé." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: AiConversationPage,
});

const SUGGESTIONS: Record<AgentType, string[]> = {
  coach: ["Analyse ma journée et donne-moi la priorité de ce soir", "J'ai mangé un poulet curry avec du riz", "Mets mon poids à 78,4 kg"],
  build: ["Créer un bug : le scan se ferme trop tôt", "Proposer une amélioration pour le suivi du sommeil", "Structurer une fonctionnalité de planification des repas"],
};

function AiConversationPage() {
  const { agentType, conversationId } = Route.useParams();
  const navigate = useNavigate();
  const getConversation = useServerFn(getAiConversation);
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [title, setTitle] = useState("Nouvelle conversation");
  const [ephemeral, setEphemeral] = useState(false);
  useEffect(() => {
    setInitialMessages(null);
    void getConversation({ data: { id: conversationId, agentType } }).then((bundle) => {
      if (!bundle) { void navigate({ to: "/assistant", replace: true }); return; }
      setTitle(bundle.conversation.title);
      setInitialMessages(bundle.messages as UIMessage[]);
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Conversation inaccessible"));
  }, [agentType, conversationId, getConversation, navigate]);
  if (!initialMessages) return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  return <ChatWorkspace key={`${agentType}-${conversationId}`} agentType={agentType} conversationId={conversationId} initialMessages={initialMessages} title={title} ephemeral={ephemeral} onEphemeralChange={setEphemeral} />;
}

function ChatWorkspace({ agentType, conversationId, initialMessages, title, ephemeral, onEphemeralChange }: { agentType: AgentType; conversationId: string; initialMessages: UIMessage[]; title: string; ephemeral: boolean; onEphemeralChange: (value: boolean) => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/ai-chat",
    fetch: async (input, init) => {
      const { data } = await supabase.auth.getSession();
      const headers = new Headers(init?.headers);
      if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
      return fetch(input, { ...init, headers });
    },
    body: { conversationId, agentType, ephemeral },
  }), [agentType, conversationId, ephemeral]);
  const { messages, sendMessage, status, error, addToolApprovalResponse, setMessages } = useChat({ id: conversationId, messages: initialMessages, transport, throttle: 40, onFinish: () => inputRef.current?.focus(), onError: (chatError) => toast.error(chatError.message) });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => { inputRef.current?.focus(); }, [conversationId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, status]);
  useEffect(() => { if (error) toast.error(error.message); }, [error]);
  const send = async (text = input) => { const clean = text.trim(); if (!clean || busy) return; setInput(""); await sendMessage({ text: clean }); inputRef.current?.focus(); };
  const switchAgent = async (next: AgentType) => {
    if (next === agentType) return;
    const { data } = await supabase.from("ai_conversations").select("id").eq("agent_type", next).eq("is_archived", false).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    let id = data?.id;
    if (!id) { const user = (await supabase.auth.getUser()).data.user; if (!user) return; const { data: created, error: createError } = await supabase.from("ai_conversations").insert({ agent_type: next, user_id: user.id }).select("id").single(); if (createError) { toast.error(createError.message); return; } id = created.id; }
    await navigate({ to: "/ai/$agentType/$conversationId", params: { agentType: next, conversationId: id } });
  };
  const toggleEphemeral = (value: boolean) => { onEphemeralChange(value); setMessages([]); toast(value ? "Chat éphémère activé" : "Historique synchronisé activé"); };

  return <div className="h-[calc(100dvh-7rem)] md:h-[calc(100dvh-5rem)] flex gap-3 overflow-hidden">
    <section className="flex-1 min-w-0 flex flex-col glass-card rounded-[24px] overflow-hidden">
      <header className="shrink-0 px-3 sm:px-5 py-3 border-b border-border/60 flex items-center gap-3">
        <div className="md:hidden"><Sheet><SheetTrigger asChild><Button variant="ghost" size="icon"><Menu className="size-4" /></Button></SheetTrigger><SheetContent side="right" className="w-[86vw] p-4"><ConversationHistory activeId={conversationId} agentType={agentType} /></SheetContent></Sheet></div>
        <div className="flex rounded-xl glass-thin p-1"><Button size="sm" variant={agentType === "coach" ? "default" : "ghost"} onClick={() => void switchAgent("coach")}><Brain className="size-4 mr-1.5" />Coach IA</Button><Button size="sm" variant={agentType === "build" ? "default" : "ghost"} onClick={() => void switchAgent("build")}><Code2 className="size-4 mr-1.5" />BUILD IA</Button></div>
        <div className="min-w-0 flex-1 hidden sm:block"><div className="text-sm font-medium truncate">{ephemeral ? "Chat éphémère" : title}</div><div className="text-[11px] text-muted-foreground">{agentType === "coach" ? "Suivi personnel & actions santé" : "Bugs, idées & développement"}</div></div>
        <div className="flex items-center gap-2"><Clock3 className="size-3.5 text-muted-foreground" /><span className="hidden lg:inline text-xs text-muted-foreground">Éphémère</span><Switch checked={ephemeral} onCheckedChange={toggleEphemeral} /></div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-5 space-y-5">
        {messages.length === 0 && <EmptyState agentType={agentType} onPick={(text) => void send(text)} />}
        {messages.map((message) => <MessageBubble key={message.id} message={message} onApproval={(id, approved) => addToolApprovalResponse({ id, approved })} />)}
        {status === "submitted" && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Réflexion en cours…</div>}
        <div ref={bottomRef} />
      </div>
      <footer className="shrink-0 p-3 sm:p-4 border-t border-border/60"><div className="glass-thin rounded-2xl p-2 flex items-end gap-2"><Textarea ref={inputRef} autoFocus value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={agentType === "coach" ? "Parlez de votre journée ou demandez une action…" : "Décrivez un bug, une idée ou une fonctionnalité…"} rows={1} className="min-h-11 max-h-40 resize-none border-0 bg-transparent focus-visible:ring-0" /><Button size="icon" onClick={() => void send()} disabled={!input.trim() || busy} aria-label="Envoyer">{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</Button></div><div className="mt-2 text-center text-[10px] text-muted-foreground">Les actions et accès aux données respectent vos permissions IA.</div></footer>
    </section>
    <aside className="hidden md:block w-72 shrink-0 glass-card rounded-[24px] p-3 overflow-hidden"><ConversationHistory activeId={conversationId} agentType={agentType} /></aside>
  </div>;
}

function EmptyState({ agentType, onPick }: { agentType: AgentType; onPick: (text: string) => void }) { const Icon = agentType === "coach" ? Brain : Code2; return <div className="max-w-xl mx-auto pt-12 text-center"><span className="glass-icon size-14 mx-auto"><Icon className="size-6 text-primary" /></span><h1 className="font-display text-2xl font-semibold mt-4">{agentType === "coach" ? "Votre coach connaît votre Pace" : "Construisons Pace intelligemment"}</h1><p className="text-sm text-muted-foreground mt-2">{agentType === "coach" ? "Analyse, conseils et actions directes sur vos données autorisées." : "Transformez vos retours en éléments de développement structurés."}</p><div className="mt-6 grid gap-2 text-left">{SUGGESTIONS[agentType].map((suggestion) => <Button key={suggestion} variant="outline" className="h-auto justify-between text-left py-3 whitespace-normal" onClick={() => onPick(suggestion)}><span>{suggestion}</span><ChevronRight className="size-4 shrink-0" /></Button>)}</div></div>; }

function MessageBubble({ message, onApproval }: { message: UIMessage; onApproval: (id: string, approved: boolean) => void }) { const assistant = message.role === "assistant"; return <div className={`flex gap-3 ${assistant ? "justify-start" : "justify-end"}`}>{assistant && <span className="glass-icon size-8 shrink-0"><Bot className="size-4 text-primary" /></span>}<div className={`max-w-[88%] sm:max-w-[78%] space-y-2 ${assistant ? "" : "rounded-2xl bg-primary text-primary-foreground px-4 py-2.5"}`}>{message.parts.map((part, index) => { if (part.type === "text") return <div key={index} className="text-sm leading-relaxed [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"><ReactMarkdown>{part.text}</ReactMarkdown></div>; if (part.type === "reasoning") return <details key={index} className="text-xs text-muted-foreground glass-thin rounded-xl px-3 py-2"><summary className="cursor-pointer">Raisonnement</summary><div className="mt-2 whitespace-pre-wrap">{part.text}</div></details>; if (part.type.startsWith("tool-")) return <ToolPart key={index} part={part as unknown as Record<string, unknown>} onApproval={onApproval} />; return null; })}</div></div>; }

function ToolPart({ part, onApproval }: { part: Record<string, unknown>; onApproval: (id: string, approved: boolean) => void }) { const state = typeof part.state === "string" ? part.state : ""; const approval = typeof part.approval === "object" && part.approval ? part.approval as Record<string, unknown> : null; const toolName = typeof part.type === "string" ? part.type.replace("tool-", "").replaceAll("_", " ") : "action"; if (state === "approval-requested" && approval && approval.isAutomatic !== true && typeof approval.id === "string") return <div className="glass-card rounded-2xl p-3 text-sm"><div className="font-medium">Autoriser : {toolName} ?</div><div className="flex gap-2 mt-3"><Button size="sm" onClick={() => onApproval(approval.id as string, true)}><Check className="size-3.5 mr-1" />Confirmer</Button><Button size="sm" variant="outline" onClick={() => onApproval(approval.id as string, false)}><X className="size-3.5 mr-1" />Refuser</Button></div></div>; const success = state === "output-available"; return <div className="glass-thin rounded-xl px-3 py-2 flex items-center gap-2 text-xs"><span className={`size-5 rounded-full grid place-items-center ${success ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>{success ? <Check className="size-3" /> : <Loader2 className="size-3 animate-spin" />}</span><span className="capitalize">{toolName}</span></div>; }

function ConversationHistory({ activeId, agentType }: { activeId: string; agentType: AgentType }) {
  const navigate = useNavigate(); const list = useServerFn(listAiConversations); const create = useServerFn(createAiConversation); const update = useServerFn(updateAiConversation); const remove = useServerFn(deleteAiConversation); const [rows, setRows] = useState<AiConversation[]>([]);
  const refresh = async () => setRows((await list({ data: { agentType } })) as AiConversation[]);
  useEffect(() => { void refresh(); }, [agentType]);
  const newConversation = async () => { const row = await create({ data: { agentType } }); await navigate({ to: "/ai/$agentType/$conversationId", params: { agentType, conversationId: row.id } }); };
  return <div className="h-full flex flex-col"><div className="flex items-center justify-between px-1 pb-3"><div className="font-medium flex items-center gap-2"><History className="size-4" />Conversations</div><Button size="icon" variant="ghost" onClick={() => void newConversation()} aria-label="Nouvelle conversation"><Plus className="size-4" /></Button></div><div className="flex-1 min-h-0 overflow-y-auto space-y-1">{rows.map((row) => <div key={row.id} className={`group flex items-center rounded-xl ${row.id === activeId ? "bg-primary/10 text-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}><Button variant="ghost" className="flex-1 min-w-0 justify-start font-normal" onClick={() => void navigate({ to: "/ai/$agentType/$conversationId", params: { agentType, conversationId: row.id } })}>{row.is_starred && <Star className="size-3.5 fill-current text-amber-500 shrink-0" />}<span className="truncate">{row.title}</span></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8 opacity-60 group-hover:opacity-100"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={async () => { await update({ data: { id: row.id, isStarred: !row.is_starred } }); await refresh(); }}><Star />{row.is_starred ? "Retirer des favoris" : "Ajouter aux favoris"}</DropdownMenuItem><DropdownMenuItem onClick={async () => { await update({ data: { id: row.id, isArchived: true } }); await refresh(); }}><Archive />Archiver</DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={async () => { await remove({ data: { id: row.id } }); const remaining = rows.filter((item) => item.id !== row.id); if (row.id === activeId) { const next = remaining[0] ?? await create({ data: { agentType } }); await navigate({ to: "/ai/$agentType/$conversationId", params: { agentType, conversationId: next.id } }); } else await refresh(); }}><Trash2 />Supprimer</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</div><Button variant="outline" className="mt-3" onClick={() => void navigate({ to: "/ai-activity" })}><Sparkles className="size-4 mr-2" />Historique des actions</Button></div>;
}