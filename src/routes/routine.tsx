import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Flame, Trash2 } from "lucide-react";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, todayKey, fmtDay } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/routine")({
  head: () => ({ meta: [{ title: "Routine — Pace" }, { name: "description", content: "Habit tracker : streaks, % de réussite, historique." }] }),
  component: RoutinePage,
});

type Habit = { id: string; name: string; emoji: string };

function RoutinePage() {
  const [habits, setHabits] = useLocalState<Habit[]>("lt.routine.list", [
    { id: "h1", name: "Sport", emoji: "🏋️" },
    { id: "h2", name: "Lecture", emoji: "📖" },
    { id: "h3", name: "Méditation", emoji: "🧘" },
    { id: "h4", name: "Douche froide", emoji: "❄️" },
  ]);
  const [done, setDone] = useLocalState<Record<string, string[]>>("lt.routine.done", {});
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("✨");

  const today = todayKey();
  const todayDone = done[today] ?? [];

  const toggle = (id: string) => {
    setDone((p) => {
      const arr = p[today] ?? [];
      return { ...p, [today]: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] };
    });
  };

  const addHabit = () => {
    if (!name) return;
    setHabits((p) => [...p, { id: crypto.randomUUID(), name, emoji }]);
    setName(""); setEmoji("✨");
  };

  const removeHabit = (id: string) => setHabits((p) => p.filter((h) => h.id !== id));

  const days = lastNDays(30);
  const successRate = (id: string) => {
    const c = days.filter((d) => (done[d] ?? []).includes(id)).length;
    return Math.round((c / days.length) * 100);
  };
  const streak = (id: string) => {
    let s = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if ((done[days[i]] ?? []).includes(id)) s++;
      else break;
    }
    return s;
  };

  const overallToday = habits.length ? (todayDone.length / habits.length) * 100 : 0;
  const last7 = lastNDays(7);
  const avg7 = habits.length
    ? Math.round(
        (last7.reduce((s, d) => s + (done[d] ?? []).length, 0) / (last7.length * habits.length)) * 100
      )
    : 0;

  return (
    <div>
      <PageHeader title="Routine & habitudes" subtitle="Petits gestes quotidiens, grands résultats." />

      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard label="Aujourd'hui" value={`${todayDone.length}/${habits.length}`} unit={`${overallToday.toFixed(0)}%`} />
        <StatCard label="Moyenne 7j" value={`${avg7}`} unit="%" icon={<Flame className="size-4" />} />
        <StatCard label="Habitudes" value={habits.length} />
      </div>

      <div className="rounded-2xl bg-card border border-border p-5 shadow-[var(--shadow-soft)] mb-4">
        <div className="flex gap-2">
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-16 text-center" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouvelle habitude" />
          <Button onClick={addHabit} className="rounded-xl"><Plus className="size-4" /></Button>
        </div>
      </div>

      <div className="space-y-2">
        {habits.map((h) => {
          const isDone = todayDone.includes(h.id);
          return (
            <div
              key={h.id}
              className={`group flex items-center gap-4 rounded-2xl border p-4 transition-all cursor-pointer ${
                isDone ? "bg-primary/5 border-primary/30" : "bg-card border-border"
              }`}
              onClick={() => toggle(h.id)}
            >
              <div className="text-2xl">{h.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{h.name}</div>
                <div className="text-xs text-muted-foreground">
                  🔥 {streak(h.id)} jours · {successRate(h.id)}% (30j)
                </div>
                <div className="flex gap-0.5 mt-1.5">
                  {lastNDays(14).map((d) => (
                    <div
                      key={d}
                      title={fmtDay(d)}
                      className="flex-1 h-1.5 rounded-full"
                      style={{
                        background: (done[d] ?? []).includes(h.id) ? "var(--primary)" : "var(--muted)",
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className={`size-7 rounded-full border-2 grid place-items-center transition-all ${isDone ? "bg-primary border-primary" : "border-border"}`}>
                {isDone && <span className="text-primary-foreground text-sm">✓</span>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeHabit(h.id); }}
                className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
