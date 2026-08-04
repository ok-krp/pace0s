import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Send, Loader2, Apple, Dumbbell, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useLocalState, todayKey } from "@/lib/storage";
import { springSoft } from "@/lib/motion";
import { assistantChat, type AssistantAction } from "@/lib/assistant.functions";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "Assistant IA — Pace" },
      { name: "description", content: "Parlez naturellement : l'assistant Pace enregistre vos repas et vos séances." },
      { property: "og:title", content: "Assistant IA — Pace" },
      { property: "og:description", content: "Un assistant qui comprend vos phrases et met à jour votre suivi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistantPage,
});

type ChatMsg = { id: string; role: "user" | "assistant"; content: string; actions?: AssistantAction[] };

type Exercise = { id: string; name: string; muscle: string; defaultSets?: number; defaultReps?: number; defaultWeight?: number };
type OverloadRow = { id: string; date: string; weight: number; reps: number; sets: number; note?: string };
type OverloadStore = Record<string, OverloadRow[]>;

const SUGGESTIONS = [
  "Pec Fly 8 reps 2 séries 59 kg",
  "J'ai mangé un poulet curry avec du riz",
  "Comment améliorer mes protéines aujourd'hui ?",
];

function AssistantPage() {
  const { user } = useAuth();
  const ask = useServerFn(assistantChat);
  const [messages, setMessages] = useLocalState<ChatMsg[]>("lt.assistant.messages", []);
  const [exs, setExs] = useLocalState<Exercise[]>("lt.sport.exercises", []);
  const [overload, setOverload] = useLocalState<OverloadStore>("lt.sport.overload", {});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const applyAction = async (a: AssistantAction) => {
    if (a.type === "food") {
      if (!user) return;
      const { error } = await supabase.from("food_log").insert({
        user_id: user.id,
        meal: a.meal,
        name: a.grams ? `${a.name} (${Math.round(a.grams)}g)` : a.name,
        kcal: +a.kcal.toFixed(1),
        protein_g: +a.protein_g.toFixed(1),
        carbs_g: +a.carbs_g.toFixed(1),
        fat_g: +a.fat_g.toFixed(1),
        fiber_g: +a.fiber_g.toFixed(1),
        sugar_g: +a.sugar_g.toFixed(1),
        sodium_mg: +a.sodium_mg.toFixed(1),
        source: "assistant",
        meta: { grams: Math.round(a.grams) },
      });
      if (error) toast.error(error.message);
      return;
    }

    // workout → surcharge progressive
    let exId = a.exercise_id && exs.some((e) => e.id === a.exercise_id) ? a.exercise_id : null;
    if (!exId) {
      const match = exs.find((e) => e.name.toLowerCase() === a.exercise_name.toLowerCase());
      exId = match?.id ?? null;
    }
    if (!exId) {
      const created: Exercise = {
        id: crypto.randomUUID(),
        name: a.exercise_name,
        muscle: a.muscle || "Autre",
        defaultSets: a.sets,
        defaultReps: a.reps,
        defaultWeight: a.weight,
      };
      exId = created.id;
      setExs([...exs, created]);
    }
    const row: OverloadRow = {
      id: crypto.randomUUID(),
      date: todayKey(),
      weight: a.weight,
      reps: a.reps,
      sets: a.sets,
      note: "Assistant IA",
    };
    setOverload({ ...overload, [exId]: [...(overload[exId] ?? []), row] });
  };

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await ask({
        data: {
          message: text,
          history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          exercises: exs.slice(0, 200).map((e) => ({ id: e.id, name: e.name, muscle: e.muscle })),
        },
      });
      if (res.error || !res.result) {
        toast.error(res.error ?? "Erreur IA");
        return;
      }
      for (const a of res.result.actions) await applyAction(a);
      setMessages([
        ...next,
        { id: crypto.randomUUID(), role: "assistant", content: res.result.reply, actions: res.result.actions },
      ]);
      if (res.result.actions.length) toast.success("Données mises à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur IA");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)]">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Assistant IA" subtitle="Dites-le naturellement, Pace enregistre." />
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => setMessages([])}>
            <Trash2 className="size-4 mr-1" />Effacer
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <p className="text-sm text-muted-foreground">
              Décrivez un repas ou une série et l'assistant met à jour votre journal et votre surcharge progressive.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="text-xs px-3 py-1.5 rounded-full glass-card hover:opacity-80 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSoft}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-snug ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "glass-card"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.actions && m.actions.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {m.actions.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {a.type === "food" ? <Apple className="size-3.5" /> : <Dumbbell className="size-3.5" />}
                      {a.type === "food"
                        ? `${a.name} · ${Math.round(a.kcal)} kcal · ${a.meal}`
                        : `${a.exercise_name} · ${a.sets}×${a.reps} · ${a.weight} kg`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="glass-card rounded-2xl px-4 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Réflexion…
            </div>
          </div>
        )}
      </div>

      <div className="glass-card rounded-2xl p-2 flex items-end gap-2">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ex. : Développé couché 4 séries de 8 à 70 kg"
          rows={1}
          className="min-h-[44px] max-h-32 resize-none border-0 bg-transparent focus-visible:ring-0"
        />
        <Button onClick={() => void send()} disabled={busy || !input.trim()} className="rounded-xl shrink-0">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
