import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Utensils, Send, Loader2, X, Check, AlertTriangle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { createAiConversation, getAiConversation } from "@/lib/ai-history.functions";
import { describeChatError } from "@/lib/ai-debug";
import { todayKey } from "@/lib/storage";

const DAILY_TITLE_PREFIX = "Nutrition du jour — ";

function localDayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(year, month - 1, date));
}

export function NutritionDailyAiChat() {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(todayKey());
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const createConversation = useServerFn(createAiConversation);
  const getConversation = useServerFn(getAiConversation);

  useEffect(() => {
    const checkDay = () => {
      const next = todayKey();
      setDay((current) => current === next ? current : next);
    };
    const timer = window.setInterval(checkDay, 30_000);
    window.addEventListener("visibilitychange", checkDay);
    return () => { window.clearInterval(timer); window.removeEventListener("visibilitychange", checkDay); };
  }, []);

  useEffect(() => {
    setConversationId(null);
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const title = `${DAILY_TITLE_PREFIX}${localDayLabel(day)}`;
        const { data: existing, error: existingError } = await supabase
          .from("ai_conversations")
          .select("id,title")
          .eq("agent_type", "coach")
          .eq("title", title)
          .eq("is_archived", false)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingError) throw existingError;

        let id = existing?.id ?? null;
        if (!id) {
          const created = await createConversation({ data: { agentType: "coach" } });
          id = created.id;
          const { error: titleError } = await supabase.from("ai_conversations").update({ title }).eq("id", id);
          if (titleError) throw titleError;
        }

        await supabase
          .from("ai_conversations")
          .update({ is_archived: true })
          .eq("agent_type", "coach")
          .eq("is_archived", false)
          .like("title", `${DAILY_TITLE_PREFIX}%`)
          .neq("id", id);

        if (!cancelled) setConversationId(id);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Impossible d’ouvrir le journal IA.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, day, createConversation]);

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Décrire ce que j’ai mangé aujourd’hui"
      className="glass-icon size-14 text-white bg-gradient-to-br from-orange-500/80 to-amber-600/80 shadow-[var(--shadow-glow)] hover:scale-105 active:scale-95 transition"
    >
      <Utensils className="size-6" />
    </button>

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border/60">
          <DialogTitle className="flex items-center gap-2"><Utensils className="size-5 text-orange-500" />Nutrition du jour</DialogTitle>
          <p className="text-xs text-muted-foreground">{localDayLabel(day)} · Le chat se réinitialise automatiquement à 00:00.</p>
        </DialogHeader>
        {loading || !conversationId ? (
          <div className="h-[55vh] grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : <DailyChat conversationId={conversationId} day={day} getConversation={getConversation} />}
      </DialogContent>
    </Dialog>
  </>;
}

function DailyChat({ conversationId, day, getConversation }: { conversationId: string; day: string; getConversation: ReturnType<typeof useServerFn<typeof getAiConversation>> }) {
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoApprovalKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInitialMessages(null);
    void getConversation({ data: { id: conversationId, agentType: "coach" } }).then((bundle) => {
      if (!cancelled) setInitialMessages((bundle?.messages ?? []) as UIMessage[]);
    }).catch((error) => {
      if (!cancelled) setFailure(error instanceof Error ? error.message : "Conversation inaccessible");
    });
    return () => { cancelled = true; };
  }, [conversationId, getConversation]);

  if (!initialMessages) return <div className="h-[55vh] grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  return <DailyChatSession key={`${conversationId}-${day}`} conversationId={conversationId} initialMessages={initialMessages} input={input} setInput={setInput} failure={failure} setFailure={setFailure} inputRef={inputRef} autoApprovalKeyRef={autoApprovalKeyRef} />;
}

function DailyChatSession({ conversationId, initialMessages, input, setInput, failure, setFailure, inputRef, autoApprovalKeyRef }: { conversationId: string; initialMessages: UIMessage[]; input: string; setInput: (value: string) => void; failure: string | null; setFailure: (value: string | null) => void; inputRef: React.RefObject<HTMLTextAreaElement | null>; autoApprovalKeyRef: React.MutableRefObject<string | null> }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/ai-chat",
    fetch: async (url, init) => {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error("Authentification expirée : reconnectez-vous puis renvoyez votre message.");
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${data.session.access_token}`);
      return fetch(url, { ...init, headers });
    },
    prepareSendMessagesRequest: ({ messages: all, body }) => ({ body: { ...body, messages: all.slice(-30) } }),
    body: { conversationId, agentType: "coach", ephemeral: false },
  }), [conversationId]);
  const sendAutomaticallyWhen = useMemo(() => ({ messages }: { messages: UIMessage[] }) => {
    const last = messages.at(-1);
    if (!last || last.role !== "assistant") return false;
    const responses = last.parts.filter((part) => {
      const candidate = part as unknown as Record<string, unknown>;
      const approval = candidate.approval;
      return candidate.state === "approval-responded" && typeof approval === "object" && approval !== null && typeof (approval as Record<string, unknown>).id === "string";
    }).map((part) => {
      const approval = (part as unknown as Record<string, unknown>).approval as Record<string, unknown>;
      return `${approval.id}:${approval.approved === true ? "approved" : "denied"}`;
    });
    if (!responses.length) return false;
    const key = `${last.id}:${responses.join("|")}`;
    if (autoApprovalKeyRef.current === key) return false;
    autoApprovalKeyRef.current = key;
    return true;
  }, [autoApprovalKeyRef]);
  const { messages, sendMessage, status, addToolApprovalResponse } = useChat({ id: conversationId, messages: initialMessages, transport, throttle: 40, sendAutomaticallyWhen, onFinish: () => { setFailure(null); inputRef.current?.focus(); }, onError: (error) => setFailure(describeChatError(error)) });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, status]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setFailure(null);
    try { await sendMessage({ text }); } catch (error) { setInput(text); setFailure(describeChatError(error)); }
  };

  return <div className="flex flex-col h-[55vh]">
    <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
      {messages.length === 0 && <div className="rounded-2xl glass-thin p-4 text-sm text-muted-foreground"><div className="font-medium text-foreground mb-1">Qu’as-tu mangé aujourd’hui ?</div><div>Écris tout en une fois, par exemple : « ce matin un café et deux tartines, à midi poulet avec riz et ce soir une pizza ». Je m’occupe de détailler les aliments et de les ajouter au journal.</div></div>}
      {messages.map((message) => <NutritionMessage key={message.id} message={message} onApproval={(id, approved) => addToolApprovalResponse({ id, approved })} />)}
      {status === "submitted" && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />Analyse et enregistrement…</div>}
      {failure && <div className="rounded-xl border border-destructive/40 p-3 text-sm"><div className="flex items-start gap-2"><AlertTriangle className="size-4 text-destructive mt-0.5" /><div><div className="font-medium text-destructive">Envoi impossible</div><div className="text-muted-foreground mt-1">{failure}</div></div></div></div>}
      <div ref={bottomRef} />
    </div>
    <div className="p-3 border-t border-border/60">
      <div className="glass-thin rounded-2xl p-2 flex items-end gap-2">
        <Textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Écris tout ce que tu as mangé…" className="min-h-11 max-h-28 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" disabled={busy} />
        <Button size="icon" onClick={() => void send()} disabled={!input.trim() || busy} aria-label="Envoyer"><Send className="size-4" /></Button>
      </div>
      <div className="text-[10px] text-muted-foreground mt-2 text-center">Les aliments ajoutés apparaissent directement dans Nutrition.</div>
    </div>
  </div>;
}

function NutritionMessage({ message, onApproval }: { message: UIMessage; onApproval: (id: string, approved: boolean) => void }) {
  const assistant = message.role === "assistant";
  const text = message.parts.filter((part) => part.type === "text").map((part) => ("text" in part ? part.text : "")).join("\n");
  const approvals = message.parts.map((part) => {
    const candidate = part as unknown as Record<string, unknown>;
    const approval = candidate.approval;
    if (candidate.state !== "approval-requested" || typeof approval !== "object" || approval === null) return null;
    const value = approval as Record<string, unknown>;
    return typeof value.id === "string" ? value.id : null;
  }).filter((id): id is string => Boolean(id));
  return <div className={`flex ${assistant ? "justify-start" : "justify-end"}`}>
    <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${assistant ? "glass-thin" : "bg-primary text-primary-foreground"}`}>
      {text || (assistant ? "Action nutrition en cours…" : "")}
      {approvals.map((id) => <div key={id} className="mt-3 flex gap-2"><Button size="sm" onClick={() => onApproval(id, true)}><Check className="size-3.5 mr-1" />Ajouter</Button><Button size="sm" variant="outline" onClick={() => onApproval(id, false)}><X className="size-3.5 mr-1" />Refuser</Button></div>)}
    </div>
  </div>;
}
