import { createFileRoute } from "@tanstack/react-router";
import { liquidTooltipStyle } from "@/lib/chart-style";
import { useState } from "react";
import { Moon, Plus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, fmtDay, todayKey } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/sleep")({
  head: () => ({ meta: [{ title: "Sommeil — Pace" }, { name: "description", content: "Suivi du sommeil intelligent : heures, dette, qualité, tendances." }] }),
  component: SleepPage,
});

function diffHours(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let s = sh + sm / 60;
  let e = eh + em / 60;
  if (e < s) e += 24;
  return Math.max(0, e - s);
}

function SleepPage() {
  const [entries, setEntries] = useLocalState<Record<string, { start: string; end: string; hours: number; quality: number }>>("lt.sleep", {});
  const [start, setStart] = useState("23:30");
  const [end, setEnd] = useState("07:00");
  const [quality, setQuality] = useState(8);

  const range = "30";
  const days = lastNDays(Number(range));
  const data = days.map((d) => ({ d, label: fmtDay(d), h: entries[d]?.hours ?? null }));
  const valid = data.filter((x) => x.h !== null) as { d: string; label: string; h: number }[];
  const avg = valid.length ? valid.reduce((s, x) => s + x.h, 0) / valid.length : 0;
  const best = valid.reduce((b, x) => (x.h > b ? x.h : b), 0);
  const worst = valid.length ? valid.reduce((w, x) => (x.h < w ? x.h : w), 24) : 0;
  const debt = Math.max(0, valid.length * 8 - valid.reduce((s, x) => s + x.h, 0));

  const add = () => {
    const h = diffHours(start, end);
    setEntries((p) => ({ ...p, [todayKey()]: { start, end, hours: h, quality } }));
  };

  return (
    <div>
      <PageHeader title="Sommeil" subtitle="Détectez les patterns, comblez la dette." />

      <div className="rounded-2xl glass-card p-5 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Endormi à</label>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Réveil</label>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Qualité (1-10)</label>
            <Input type="number" min={1} max={10} value={quality} onChange={(e) => setQuality(+e.target.value)} className="w-24" />
          </div>
          <Button onClick={add} className="rounded-xl">
            <Plus className="size-4 mr-1" /> Enregistrer
          </Button>
          <div className="text-sm text-muted-foreground ml-auto">
            <Moon className="inline size-4 mr-1" /> {diffHours(start, end).toFixed(1)} h
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Moyenne" value={avg.toFixed(1)} unit="h" />
        <StatCard label="Meilleur" value={best.toFixed(1)} unit="h" />
        <StatCard label="Pire" value={worst === 24 ? "—" : worst.toFixed(1)} unit="h" />
        <StatCard label="Dette" value={debt.toFixed(1)} unit="h" />
      </div>

      <div className="rounded-2xl glass-card p-5">
        <div className="font-display text-lg font-semibold mb-3">Tendance 30 jours</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <YAxis fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <Tooltip contentStyle={liquidTooltipStyle} />
            <Line type="monotone" dataKey="h" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
