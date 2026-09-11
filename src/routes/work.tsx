import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Briefcase, Trash2, Plus, Check, StickyNote, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { useLocalState, lastNDays, fmtDay, todayKey } from "@/lib/storage";
import { useDomainState } from "@/lib/domain-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/work")({
  head: () => ({ meta: [{ title: "Travail, routine & notes — Pace" }, { name: "description", content: "Travail, routine et notes réunis dans un seul espace quotidien." }] }),
  component: WorkPage,
});

type Habit = { id: string; name: string; emoji: string };
type Note = { id: string; title: string; html: string; pinned: boolean; color: string; createdAt: number; updatedAt: number };
const CATS = ["École", "Business", "Sport", "Projets"];
const textPreview = (html: string) => { if (typeof document === "undefined") return ""; const div = document.createElement("div"); div.innerHTML = html; return (div.textContent || "").trim().slice(0, 100); };

function WorkPage() {
  const navigate = useNavigate();
  const [data, setData] = useLocalState<Record<string, number>>("pace.work.minutes", {});
  const [sessions, setSessions] = useLocalState<Array<{ id: string; date: string; cat: string; minutes: number }>>("pace.work.sessions", []);
  const [cat, setCat] = useState("Business"); const [running, setRunning] = useState(false); const [seconds, setSeconds] = useState(0); const ref = useRef<number | null>(null);
  const [legacyHabits] = useLocalState<Habit[]>("pace.routine.list", [{ id: "h1", name: "Sport", emoji: "🏋️" }, { id: "h2", name: "Lecture", emoji: "📖" }, { id: "h3", name: "Méditation", emoji: "🧘" }, { id: "h4", name: "Douche froide", emoji: "❄️" }]);
  const [legacyDone] = useLocalState<Record<string, string[]>>("pace.routine.done", {});
  const [habits, setHabits] = useDomainState<Habit[]>("routine.list", legacyHabits);
  const [done, setDone] = useDomainState<Record<string, string[]>>("routine.done", legacyDone);
  const [habitName, setHabitName] = useState(""); const [habitEmoji, setHabitEmoji] = useState("✨");
  const [notes] = useLocalState<Note[]>("pace.notes.list", []);
  const today = todayKey();

  useEffect(() => { if (running) ref.current = window.setInterval(() => setSeconds((s) => s + 1), 1000); return () => { if (ref.current) clearInterval(ref.current); }; }, [running]);
  const stop = () => { setRunning(false); if (seconds > 0) { const m = Math.max(1, Math.round(seconds / 60)); setData((p) => ({ ...p, [today]: (p[today] ?? 0) + m })); setSessions((p) => [{ id: crypto.randomUUID(), date: today, cat, minutes: m }, ...p].slice(0, 100)); } setSeconds(0); };
  const days = lastNDays(14); const series = days.map((d) => ({ d: fmtDay(d).slice(0, 3), min: data[d] ?? 0 })); const totalMin = series.reduce((s, x) => s + x.min, 0); const avg = totalMin / 14; const todayMin = data[today] ?? 0;
  const fmt = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const todayDone = done[today] ?? [];
  const toggleHabit = (id: string) => setDone((p) => ({ ...p, [today]: (p[today] ?? []).includes(id) ? (p[today] ?? []).filter((x) => x !== id) : [...(p[today] ?? []), id] }));
  const addHabit = () => { if (!habitName.trim()) return; setHabits((p) => [...p, { id: crypto.randomUUID(), name: habitName.trim(), emoji: habitEmoji }]); setHabitName(""); setHabitEmoji("✨"); };
  const recentNotes = [...notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt).slice(0, 5);

  return <div>
    <PageHeader title="Travail · Routine · Notes" subtitle="Un seul espace pour piloter ton quotidien." />
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <section className="glass-card p-5">
        <div className="flex items-center justify-between mb-4"><div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Travail</div><div className="font-display text-lg font-semibold mt-1">Concentration</div></div><Briefcase className="size-5 text-primary" /></div>
        <div className="grid grid-cols-3 gap-2 mb-4"><div className="glass-thin rounded-xl p-3"><div className="text-[10px] text-muted-foreground">Aujourd'hui</div><div className="font-semibold mt-1">{Math.floor(todayMin / 60)}h{todayMin % 60}</div></div><div className="glass-thin rounded-xl p-3"><div className="text-[10px] text-muted-foreground">Moy. 14j</div><div className="font-semibold mt-1">{Math.floor(avg / 60)}h{Math.round(avg % 60)}</div></div><div className="glass-thin rounded-xl p-3"><div className="text-[10px] text-muted-foreground">Total</div><div className="font-semibold mt-1">{Math.floor(totalMin / 60)}h</div></div></div>
        <div className="rounded-2xl glass-thin p-5 flex flex-col items-center gap-4"><div className="font-display text-5xl font-semibold tabular-nums tracking-tight">{fmt(seconds)}</div><Select value={cat} onValueChange={setCat}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select><div className="flex gap-2 w-full"><Button onClick={() => setRunning(!running)} className="rounded-xl flex-1">{running ? <><Pause className="size-4 mr-1" />Pause</> : <><Play className="size-4 mr-1" />Démarrer</>}</Button><Button onClick={stop} variant="secondary" className="rounded-xl"><RotateCcw className="size-4" /></Button></div></div>
        {sessions.length > 0 && <div className="mt-4 space-y-1.5">{sessions.slice(0, 4).map((s) => <div key={s.id} className="flex justify-between text-xs px-1"><span>{s.cat} · {s.date}</span><span className="text-muted-foreground">{s.minutes} min</span></div>)}</div>}
      </section>

      <section className="glass-card p-5">
        <div className="flex items-center justify-between mb-4"><div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Routine</div><div className="font-display text-lg font-semibold mt-1">Aujourd'hui · {todayDone.length}/{habits.length}</div></div><div className="text-sm font-semibold text-primary">{habits.length ? Math.round(todayDone.length / habits.length * 100) : 0}%</div></div>
        <div className="flex gap-2 mb-3"><Input value={habitEmoji} onChange={(e) => setHabitEmoji(e.target.value)} className="w-14 text-center" /><Input value={habitName} onChange={(e) => setHabitName(e.target.value)} placeholder="Nouvelle habitude" /><Button onClick={addHabit} size="icon" className="rounded-xl shrink-0"><Plus className="size-4" /></Button></div>
        <div className="space-y-2">{habits.slice(0, 8).map((h) => { const checked = todayDone.includes(h.id); return <button key={h.id} type="button" onClick={() => toggleHabit(h.id)} className={`w-full flex items-center gap-3 rounded-xl p-3 text-left transition ${checked ? "bg-primary/8" : "glass-thin"}`}><span className="text-lg">{h.emoji}</span><span className={`flex-1 text-sm ${checked ? "line-through opacity-60" : "font-medium"}`}>{h.name}</span><span className={`size-6 rounded-full border grid place-items-center ${checked ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{checked && <Check className="size-3.5" />}</span></button>; })}</div>
        <button onClick={() => navigate({ to: "/routine" })} className="mt-4 text-xs text-muted-foreground hover:text-foreground transition">Gérer toutes les habitudes →</button>
      </section>

      <section className="glass-card p-5">
        <div className="flex items-center justify-between mb-4"><div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Notes</div><div className="font-display text-lg font-semibold mt-1">Dernières notes</div></div><StickyNote className="size-5 text-primary" /></div>
        <div className="space-y-2">{recentNotes.length === 0 ? <div className="text-sm text-muted-foreground py-6 text-center">Aucune note pour le moment.</div> : recentNotes.map((n) => <button key={n.id} onClick={() => navigate({ to: "/notes" })} className="w-full text-left rounded-xl glass-thin p-3 hover:opacity-90 transition"><div className="flex items-center gap-2"><StickyNote className="size-3.5 text-primary shrink-0" /><span className="font-medium text-sm truncate">{n.title || "Sans titre"}</span></div><div className="text-xs text-muted-foreground truncate mt-1">{textPreview(n.html) || "Note vide"}</div></button>)}</div>
        <Button variant="secondary" onClick={() => navigate({ to: "/notes" })} className="w-full rounded-xl mt-4"><ExternalLink className="size-4 mr-1" />Ouvrir les notes</Button>
      </section>
    </div>
  </div>;
}
