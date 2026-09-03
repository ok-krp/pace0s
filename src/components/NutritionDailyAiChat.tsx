import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Utensils, Send, Loader2, X, Check, AlertTriangle, Heart, BookOpen } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { createAiConversation, getAiConversation } from "@/lib/ai-history.functions";
import { describeChatError } from "@/lib/ai-debug";
import { todayKey } from "@/lib/storage";
import { useDomainState } from "@/lib/domain-store";
import { useLocalState } from "@/lib/storage";

type MealItem = { id: string; name: string; meal: string; kcal: number; p: number; c: number; f: number; fiber?: number; sugar?: number; sodium?: number; qty?: number };
type Recipe = { id: string; name: string; cat: string; emoji: string; photo?: string; kcal: number; p: number; c: number; f: number; minutes: number; ingredients: string[]; steps?: string; custom?: boolean };
const DEFAULT_RECIPE_CATS = ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"];
const DAILY_TITLE_PREFIX = "Nutrition du jour — ";

function localDayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(year, month - 1, date));
}
function recipeBaseName(name: string) { return name.replace(/^\s*[\p{Extended_Pictographic}\p{Emoji_Presentation}\s]+/u, "").replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*g\s*\)\s*$/i, "").trim().toLowerCase(); }

export function NutritionDailyAiChat() {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(todayKey());
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const createConversation = useServerFn(createAiConversation);
  useEffect(() => { const checkDay = () => { const next = todayKey(); setDay((current) => current === next ? current : next); }; const timer = window.setInterval(checkDay, 30_000); window.addEventListener("visibilitychange", checkDay); return () => { window.clearInterval(timer); window.removeEventListener("visibilitychange", checkDay); }; }, []);
  useEffect(() => {
    setConversationId(null); if (!open) return; let cancelled = false; setLoading(true);
    void (async () => { try {
      const title = `${DAILY_TITLE_PREFIX}${localDayLabel(day)}`;
      const { data: existing, error: existingError } = await supabase.from("ai_conversations").select("id,title").eq("agent_type", "coach").eq("title", title).eq("is_archived", false).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (existingError) throw existingError;
      let id = existing?.id ?? null;
      if (!id) { const created = await createConversation({ data: { agentType: "coach" } }); id = created.id; const { error: titleError } = await supabase.from("ai_conversations").update({ title }).eq("id", id); if (titleError) throw titleError; }
      await supabase.from("ai_conversations").update({ is_archived: true }).eq("agent_type", "coach").eq("is_archived", false).like("title", `${DAILY_TITLE_PREFIX}%`).neq("id", id);
      if (!cancelled) setConversationId(id);
    } catch (error) { if (!cancelled) toast.error(error instanceof Error ? error.message : "Impossible d’ouvrir le journal IA."); } finally { if (!cancelled) setLoading(false); } })();
    return () => { cancelled = true; };
  }, [open, day, createConversation]);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Décrire ce que j’ai mangé aujourd’hui" className="glass-icon size-14 text-white bg-gradient-to-br from-orange-500/80 to-amber-600/80 shadow-[var(--shadow-glow)] hover:scale-105 active:scale-95 transition"><Utensils className="size-6" /></button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border/60"><DialogTitle className="flex items-center gap-2"><Utensils className="size-5 text-orange-500" />Nutrition du jour</DialogTitle><p className="text-xs text-muted-foreground">{localDayLabel(day)} · Le chat se réinitialise automatiquement à 00:00.</p></DialogHeader>
        {loading || !conversationId ? <div className="h-[55vh] grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : <DailyChat conversationId={conversationId} day={day} />}
      </DialogContent>
    </Dialog>
  </>;
}

function DailyChat({ conversationId, day }: { conversationId: string; day: string }) {
  const getConversation = useServerFn(getAiConversation);
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; setInitialMessages(null); void getConversation({ data: { id: conversationId, agentType: "coach" } }).then((bundle) => { if (!cancelled) setInitialMessages((bundle?.messages ?? []) as UIMessage[]); }).catch((error) => { if (!cancelled) setFailure(error instanceof Error ? error.message : "Conversation inaccessible"); }); return () => { cancelled = true; }; }, [conversationId, getConversation]);
  if (!initialMessages) return <div className="h-[55vh] grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  return <DailyChatSession key={`${conversationId}-${day}`} conversationId={conversationId} initialMessages={initialMessages} failure={failure} setFailure={setFailure} />;
}

function DailyChatSession({ conversationId, initialMessages, failure, setFailure }: { conversationId: string; initialMessages: UIMessage[]; failure: string | null; setFailure: (value: string | null) => void }) {
  const bottomRef = useRef<HTMLDivElement>(null); const inputRef = useRef<HTMLTextAreaElement>(null); const autoApprovalKeyRef = useRef<string | null>(null); const [input, setInput] = useState("");
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/ai-chat", fetch: async (url, init) => { const { data, error } = await supabase.auth.getSession(); if (error || !data.session) throw new Error("Authentification expirée : reconnectez-vous puis renvoyez votre message."); const headers = new Headers(init?.headers); headers.set("Authorization", `Bearer ${data.session.access_token}`); return fetch(url, { ...init, headers }); }, prepareSendMessagesRequest: ({ messages: all, body }) => ({ body: { ...body, messages: all.slice(-30) } }), body: { conversationId, agentType: "coach", ephemeral: false } }), [conversationId]);
  const sendAutomaticallyWhen = useMemo(() => ({ messages }: { messages: UIMessage[] }) => { const last = messages.at(-1); if (!last || last.role !== "assistant") return false; const responses = last.parts.filter((part) => { const candidate = part as unknown as Record<string, unknown>; const approval = candidate.approval; return candidate.state === "approval-responded" && typeof approval === "object" && approval !== null && typeof (approval as Record<string, unknown>).id === "string"; }).map((part) => { const approval = (part as unknown as Record<string, unknown>).approval as Record<string, unknown>; return `${approval.id}:${approval.approved === true ? "approved" : "denied"}`; }); if (!responses.length) return false; const key = `${last.id}:${responses.join("|")}`; if (autoApprovalKeyRef.current === key) return false; autoApprovalKeyRef.current = key; return true; }, []);
  const { messages, sendMessage, status, addToolApprovalResponse } = useChat({ id: conversationId, messages: initialMessages, transport, throttle: 40, sendAutomaticallyWhen, onFinish: () => setFailure(null), onError: (error) => setFailure(describeChatError(error)) });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, status]);
  const send = async () => { const text = input.trim(); if (!text || busy) return; setInput(""); setFailure(null); try { await sendMessage({ text }); } catch (error) { setInput(text); setFailure(describeChatError(error)); } };
  return <div className="flex flex-col h-[55vh]">
    <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
      <div className="flex justify-end"><MealToRecipeButton /></div>
      {messages.length === 0 && <div className="rounded-2xl glass-thin p-4 text-sm text-muted-foreground"><div className="font-medium text-foreground mb-1">Qu’as-tu mangé aujourd’hui ?</div><div>Écris tout en une fois, par exemple : « ce matin un café et deux tartines, à midi poulet avec riz et ce soir une pizza ». Je m’occupe de détailler les aliments et de les ajouter au journal.</div></div>}
      {messages.map((message) => <NutritionMessage key={message.id} message={message} onApproval={(id, approved) => addToolApprovalResponse({ id, approved })} />)}
      {status === "submitted" && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />Analyse et enregistrement…</div>}
      {failure && <div className="rounded-xl border border-destructive/40 p-3 text-sm"><div className="flex items-start gap-2"><AlertTriangle className="size-4 text-destructive mt-0.5" /><div><div className="font-medium text-destructive">Envoi impossible</div><div className="text-muted-foreground mt-1">{failure}</div></div></div></div>}
      <div ref={bottomRef} />
    </div>
    <div className="p-3 border-t border-border/60"><div className="glass-thin rounded-2xl p-2 flex items-end gap-2"><Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Écris tout ce que tu as mangé…" className="min-h-11 max-h-28 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" disabled={busy} ref={inputRef} /><Button size="icon" onClick={() => void send()} disabled={!input.trim() || busy} aria-label="Envoyer"><Send className="size-4" /></Button></div><div className="text-[10px] text-muted-foreground mt-2 text-center">Les aliments ajoutés apparaissent directement dans Nutrition.</div></div>
  </div>;
}

function MealToRecipeButton() {
  const day = todayKey();
  const [items] = useDomainState<Record<string, MealItem[]>>("nutrition.items", {});
  const [custom, setCustom] = useLocalState<Recipe[]>("pace.recipes.custom", []);
  const [extraCats, setExtraCats] = useLocalState<string[]>("pace.recipes.cats", []);
  const [favs, setFavs] = useLocalState<string[]>("pace.recipes.favs", []);
  const [open, setOpen] = useState(false);
  const [meal, setMeal] = useState("");
  const [category, setCategory] = useState(DEFAULT_RECIPE_CATS[0]);
  const [newCategory, setNewCategory] = useState("");
  const [favorite, setFavorite] = useState(false);
  const cats = [...DEFAULT_RECIPE_CATS, ...extraCats];
  const meals = ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner", "Collation"].map((value) => ({ value, count: (items[day] ?? []).filter((x) => x.meal === value).length })).filter((x) => x.count > 0);
  const selected = (items[day] ?? []).filter((x) => x.meal === meal);
  useEffect(() => { if (!meal && meals[0]) setMeal(meals[0].value); if (meal && !meals.some((x) => x.value === meal)) setMeal(meals[0]?.value ?? ""); }, [meal, meals]);
  const addCategory = () => { const value = newCategory.trim(); if (!value) return; if (cats.includes(value)) { toast.error("Cette catégorie existe déjà."); return; } setExtraCats((prev) => [...prev, value]); setCategory(value); setNewCategory(""); };
  const save = () => {
    if (!selected.length) { toast.error("Ce repas est vide."); return; }
    const grouped = new Map<string, { item: MealItem; kcal: number; p: number; c: number; f: number; count: number }>();
    for (const item of selected) { const key = recipeBaseName(item.name); const current = grouped.get(key); if (current) { current.kcal += Number(item.kcal || 0); current.p += Number(item.p || 0); current.c += Number(item.c || 0); current.f += Number(item.f || 0); current.count += 1; } else grouped.set(key, { item, kcal: Number(item.kcal || 0), p: Number(item.p || 0), c: Number(item.c || 0), f: Number(item.f || 0), count: 1 }); }
    const rows = [...grouped.values()]; const total = rows.reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 });
    const name = rows.length === 1 ? rows[0].item.name.replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*g\s*\)\s*$/i, "").trim() : `${meal} — ${rows.map((x) => x.item.name.replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*g\s*\)\s*$/i, "").trim()).slice(0, 3).join(" + ")}${rows.length > 3 ? " + …" : ""}`;
    const recipeId = crypto.randomUUID(); const recipe: Recipe = { id: recipeId, name, cat: category, emoji: "🍽️", kcal: Math.round(total.kcal), p: +total.p.toFixed(1), c: +total.c.toFixed(1), f: +total.f.toFixed(1), minutes: 10, ingredients: rows.map((x) => x.item.name), custom: true };
    setCustom((prev) => [...prev, recipe]); if (favorite) setFavs((prev) => prev.includes(recipeId) ? prev : [...prev, recipeId]); toast.success(`Repas ajouté aux recettes dans « ${category} »${favorite ? " et aux favoris" : ""}.`); setOpen(false);
  };
  return <><Button type="button" size="sm" variant="secondary" className="rounded-xl" onClick={() => setOpen(true)} disabled={meals.length === 0}><BookOpen className="size-3.5 mr-1" />Ajouter aux recettes</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Ajouter un repas aux recettes</DialogTitle><DialogDescription>Choisis le repas du jour, sa catégorie de recette et si tu veux le mettre en favoris.</DialogDescription></DialogHeader><div className="space-y-4"><div><label className="text-xs text-muted-foreground">Repas du jour</label><Select value={meal} onValueChange={setMeal}><SelectTrigger><SelectValue placeholder="Choisir un repas" /></SelectTrigger><SelectContent>{meals.map((m) => <SelectItem key={m.value} value={m.value}>{m.value} · {m.count} élément{m.count > 1 ? "s" : ""}</SelectItem>)}</SelectContent></Select></div><div><label className="text-xs text-muted-foreground">Catégorie de recette</label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{cats.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent></Select></div><div className="flex gap-2"><Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nouvelle catégorie" /><Button type="button" variant="outline" onClick={addCategory}>Créer</Button></div><Button type="button" variant={favorite ? "default" : "outline"} className="w-full justify-center" onClick={() => setFavorite((value) => !value)}><Heart className={`size-4 mr-2 ${favorite ? "fill-current" : ""}`} />{favorite ? "Ajouter aux favoris" : "Ne pas ajouter aux favoris"}</Button><div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">{selected.length} élément{selected.length > 1 ? "s" : ""} seront regroupés dans une seule recette, avec les macros totales du repas.</div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button><Button onClick={save} disabled={!selected.length}>Ajouter aux recettes</Button></div></div></DialogContent></Dialog></>;
}

function NutritionMessage({ message, onApproval }: { message: UIMessage; onApproval: (id: string, approved: boolean) => void }) {
  const assistant = message.role === "assistant"; const text = message.parts.filter((part) => part.type === "text").map((part) => ("text" in part ? part.text : "")).join("\n");
  const approvals = message.parts.map((part) => { const candidate = part as unknown as Record<string, unknown>; const approval = candidate.approval; if (candidate.state !== "approval-requested" || typeof approval !== "object" || approval === null) return null; const value = approval as Record<string, unknown>; return typeof value.id === "string" ? value.id : null; }).filter((id): id is string => Boolean(id));
  return <div className={`flex ${assistant ? "justify-start" : "justify-end"}`}><div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${assistant ? "glass-thin" : "bg-primary text-primary-foreground"}`}>{text || (assistant ? "Action nutrition en cours…" : "")}{approvals.map((id) => <div key={id} className="mt-3 flex gap-2"><Button size="sm" onClick={() => onApproval(id, true)}><Check className="size-3.5 mr-1" />Ajouter</Button><Button size="sm" variant="outline" onClick={() => onApproval(id, false)}><X className="size-3.5 mr-1" />Refuser</Button></div>)}</div></div>;
}
