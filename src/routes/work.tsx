import { createFileRoute } from "@tanstack/react-router";
import { liquidTooltipStyle } from "@/lib/chart-style";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Briefcase, Trash2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, fmtDay, todayKey } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/work")({
  head: () => ({ meta: [{ title: "Travail — Pace" }, { name: "description", content: "Timer, sessions, productivité." }] }),
  component: WorkPage,
});

const CATS = ["École", "Business", "Sport", "Projets"];

function WorkPage() {
  const [data, setData] = useLocalState<Record<string, number>>("lt.work.minutes", {});
  const [sessions, setSessions] = useLocalState<Array<{ id: string; date: string; cat: string; minutes: number }>>("lt.work.sessions", []);
  const [cat, setCat] = useState("Business");
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const ref = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      ref.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [running]);

  const stop = () => {
    setRunning(false);
    if (seconds > 0) {
      const m = Math.round(seconds / 60);
      const today = todayKey();
      setData((p) => ({ ...p, [today]: (p[today] ?? 0) + m }));
      setSessions((p) => [{ id: crypto.randomUUID(), date: today, cat, minutes: m }, ...p].slice(0, 100));
    }
    setSeconds(0);
  };

  const days = lastNDays(14);
  const series = days.map((d) => ({ d: fmtDay(d).slice(0, 3), min: data[d] ?? 0 }));
  const totalMin = series.reduce((s, x) => s + x.min, 0);
  const avg = totalMin / 14;
  const today = data[todayKey()] ?? 0;

  const fmt = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div>
      <PageHeader title="Travail & Productivité" subtitle="Concentration et progression." />

      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard label="Aujourd'hui" value={`${Math.floor(today / 60)}h${today % 60}`} icon={<Briefcase className="size-4" />} />
        <StatCard label="Moyenne 14j" value={`${Math.floor(avg / 60)}h${Math.round(avg % 60)}`} />
        <StatCard label="Total 14j" value={`${Math.floor(totalMin / 60)}h`} />
      </div>

      <div className="rounded-2xl glass-card p-6 mb-4 flex flex-col items-center gap-4">
        <div className="font-display text-6xl font-semibold tabular-nums tracking-tight">{fmt(seconds)}</div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button onClick={() => setRunning(!running)} className="rounded-xl px-6">
            {running ? <><Pause className="size-4 mr-1" />Pause</> : <><Play className="size-4 mr-1" />Démarrer</>}
          </Button>
          <Button onClick={stop} variant="secondary" className="rounded-xl"><RotateCcw className="size-4 mr-1" />Stop & enregistrer</Button>
        </div>
      </div>

      <div className="rounded-2xl glass-card p-5 mb-4">
        <div className="font-display text-lg font-semibold mb-3">Heures travaillées 14j</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={series}>
            <XAxis dataKey="d" fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <YAxis fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <Tooltip contentStyle={liquidTooltipStyle} />
            <Bar dataKey="min" fill="var(--primary)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {sessions.length > 0 && (
        <div className="rounded-2xl glass-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30 font-display text-sm font-semibold">Sessions récentes</div>
          <ul className="divide-y divide-border max-h-72 overflow-y-auto">
            {sessions.map((s) => (
              <li key={s.id} className="px-5 py-3 flex justify-between items-center text-sm group gap-3">
                <span className="truncate"><span className="font-medium">{s.cat}</span> · {s.date}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-muted-foreground">{Math.floor(s.minutes / 60)}h {s.minutes % 60}m</span>
                  <button
                    onClick={() => {
                      if (!confirm("Supprimer cette session ?")) return;
                      setSessions((p) => p.filter((x) => x.id !== s.id));
                      setData((p) => {
                        const cur = p[s.date] ?? 0;
                        return { ...p, [s.date]: Math.max(0, cur - s.minutes) };
                      });
                    }}
                    className="text-muted-foreground hover:text-destructive opacity-60 group-hover:opacity-100 transition"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
