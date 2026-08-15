import { createFileRoute } from "@tanstack/react-router";
import { liquidTooltipStyle } from "@/lib/chart-style";
import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, fmtDay, todayKey } from "@/lib/storage";
import { formatSleepDuration } from "@/lib/sleep-format";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";

export const Route = createFileRoute("/sleep")({
  head: () => ({ meta: [{ title: "Sommeil — Pace" }, { name: "description", content: "Suivi du sommeil intelligent : heures, dette, qualité, tendances." }] }),
  component: SleepPage,
});

function diffHours(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  let s = sh + sm / 60;
  let e = eh + em / 60;
  if (e < s) e += 24;
  return Math.max(0, e - s);
}

function SleepPage() {
  const [entries, setEntries] = useLocalState<Record<string, { start: string; end: string; hours: number; quality: number }>>("pace.sleep", {});
  const today = todayKey();
  const existingToday = entries[today];

  // IMPORTANT: initialize the editor from the value already stored for today.
  // Previously the hard-coded 23:30/07:00 defaults were loaded every time and
  // the autosave effect then overwrote an edited value back to 7h30.
  const [start, setStart] = useState(() => existingToday?.start ?? "23:30");
  const [end, setEnd] = useState(() => existingToday?.end ?? "07:00");
  const [quality, setQuality] = useState(() => existingToday?.quality ?? 8);

  // If the stored value is changed elsewhere (e.g. Calendar pencil), update the
  // editor without replacing an active user edit with the defaults.
  useEffect(() => {
    const stored = entries[today];
    if (!stored) return;
    setStart(stored.start);
    setEnd(stored.end);
    setQuality(stored.quality);
  }, [entries, today]);

  const range = "30";
  const days = lastNDays(Number(range));
  const data = days.map((d) => ({ d, label: fmtDay(d), h: entries[d]?.hours ?? null }));
  const valid = data.filter((x) => x.h !== null) as { d: string; label: string; h: number }[];
  const avg = valid.length ? valid.reduce((s, x) => s + x.h, 0) / valid.length : 0;
  const best = valid.reduce((b, x) => (x.h > b ? x.h : b), 0);
  const worst = valid.length ? valid.reduce((w, x) => (x.h < w ? x.h : w), 24) : 0;
  const debt = Math.max(0, valid.length * 8 - valid.reduce((s, x) => s + x.h, 0));

  // Autosave remains enabled, but it now saves the actual editor values rather
  // than replacing stored values with the default 7h30 duration.
  useEffect(() => {
    const h = diffHours(start, end);
    if (h <= 0 || quality < 1 || quality > 10) return;
    const timer = window.setTimeout(() => {
      setEntries((p) => ({ ...p, [today]: { start, end, hours: h, quality } }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [start, end, quality, today, setEntries]);

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
            <NumberField allowDecimal={false} min={1} max={10} value={quality} onChange={(v) => { if (v != null) setQuality(v); }} className="w-24" />
          </div>
          <div className="text-sm text-muted-foreground ml-auto" aria-live="polite">
            <Moon className="inline size-4 mr-1" /> {formatSleepDuration(diffHours(start, end))} · sauvegardé automatiquement
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Moyenne" value={formatSleepDuration(avg)} />
        <StatCard label="Meilleur" value={formatSleepDuration(best)} />
        <StatCard label="Pire" value={worst === 24 ? "—" : formatSleepDuration(worst)} />
        <StatCard label="Dette" value={formatSleepDuration(debt)} />
      </div>

      <div className="rounded-2xl glass-card p-5">
        <h2 className="font-display text-lg font-semibold mb-3">Tendance 30 jours</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <YAxis fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <Tooltip contentStyle={liquidTooltipStyle} formatter={(v: number) => [formatSleepDuration(v), "Sommeil"]} />
            <Line type="monotone" dataKey="h" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
