import { createFileRoute } from "@tanstack/react-router";
import { liquidTooltipStyle, liquidDot } from "@/lib/chart-style";
import { useState } from "react";
import { Scale, Plus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, todayKey } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/body")({
  head: () => ({ meta: [{ title: "Poids & Corps — Pace" }, { name: "description", content: "Suivi corporel : poids, masse musculaire, masse grasse, IMC." }] }),
  component: BodyPage,
});

type Entry = { w?: number; muscle?: number; fat?: number; waist?: number };
type Point = { d: string; w?: number; muscle?: number; fat?: number };

/** Lundi de la semaine contenant cette date (sert de clé de regroupement hebdomadaire). */
function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

/** Moyenne les entrées par clé (jour/semaine/mois) — un point de graphique par bucket. */
function aggregate(entries: { date: string; e: Entry }[], keyFn: (d: string) => string, labelFn: (key: string) => string): Point[] {
  const buckets = new Map<string, { key: string; sumW: number; nW: number; sumM: number; nM: number; sumF: number; nF: number }>();
  for (const { date, e } of entries) {
    const k = keyFn(date);
    if (!buckets.has(k)) buckets.set(k, { key: k, sumW: 0, nW: 0, sumM: 0, nM: 0, sumF: 0, nF: 0 });
    const b = buckets.get(k)!;
    if (e.w != null) { b.sumW += e.w; b.nW++; }
    if (e.muscle != null) { b.sumM += e.muscle; b.nM++; }
    if (e.fat != null) { b.sumF += e.fat; b.nF++; }
  }
  return [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((b) => ({
      d: labelFn(b.key),
      w: b.nW ? Math.round((b.sumW / b.nW) * 10) / 10 : undefined,
      muscle: b.nM ? Math.round((b.sumM / b.nM) * 10) / 10 : undefined,
      fat: b.nF ? Math.round((b.sumF / b.nF) * 10) / 10 : undefined,
    }));
}

function BodyPage() {
  const [data, setData] = useLocalState<Record<string, Entry>>("lt.weight", {});
  const [w, setW] = useState("");
  const [muscle, setMuscle] = useState("");
  const [fat, setFat] = useState("");
  const [period, setPeriod] = useState(30);

  const days = lastNDays(period);
  const entries = days.map((date) => ({ date, e: data[date] ?? {} }));
  // Granularité adaptée à la période : 1 semaine → par jour, 1-3 mois → moyenne par
  // semaine, 6 mois-1 an → moyenne par mois. Sinon un an de points quotidiens serait illisible.
  const series: Point[] =
    period <= 7
      ? entries.map(({ date, e }) => ({ d: date.slice(5), ...e }))
      : period <= 90
        ? aggregate(entries, weekKey, (key) => new Date(`${key}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }))
        : aggregate(entries, monthKey, (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }));
  const validDaily = entries.filter((x) => x.e.w != null);
  const min = validDaily.length ? Math.min(...validDaily.map((x) => x.e.w!)) : 0;
  const max = validDaily.length ? Math.max(...validDaily.map((x) => x.e.w!)) : 0;
  const avg = validDaily.length ? validDaily.reduce((s, x) => s + x.e.w!, 0) / validDaily.length : 0;
  const first = validDaily[0]?.e.w;
  const last = validDaily[validDaily.length - 1]?.e.w;
  const delta = first && last ? last - first : 0;

  const save = () => {
    const e: Entry = {};
    if (w) e.w = parseFloat(w);
    if (muscle) e.muscle = parseFloat(muscle);
    if (fat) e.fat = parseFloat(fat);
    if (Object.keys(e).length === 0) return;
    setData((p) => ({ ...p, [todayKey()]: { ...p[todayKey()], ...e } }));
    setW(""); setMuscle(""); setFat("");
  };

  return (
    <div>
      <PageHeader title="Poids & Corps" subtitle="Le corps évolue, mesurez la trajectoire." />

      <div className="rounded-2xl glass-card p-5 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground">Poids (kg)</label>
            <Input type="number" step="0.1" value={w} onChange={(e) => setW(e.target.value)} placeholder="72.5" className="w-28" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Muscle (%)</label>
            <Input type="number" step="0.1" value={muscle} onChange={(e) => setMuscle(e.target.value)} placeholder="42" className="w-28" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Gras (%)</label>
            <Input type="number" step="0.1" value={fat} onChange={(e) => setFat(e.target.value)} placeholder="18" className="w-28" />
          </div>
          <Button onClick={save} className="rounded-xl"><Plus className="size-4 mr-1" />Enregistrer</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Min" value={min ? min.toFixed(1) : "—"} unit="kg" />
        <StatCard label="Moyenne" value={avg ? avg.toFixed(1) : "—"} unit="kg" icon={<Scale className="size-4" />} />
        <StatCard label="Max" value={max ? max.toFixed(1) : "—"} unit="kg" />
        <StatCard label="Variation" value={delta ? (delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : "—"} unit="kg" delta={delta && first ? (delta / first) * 100 : undefined} />
      </div>

      <div className="rounded-2xl glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold">Évolution</h2>
          <div className="flex gap-1">
            {[7, 30, 90, 180, 365].map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`text-xs px-2.5 py-1 rounded-lg ${period === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {p === 7 ? "1S" : p === 30 ? "1M" : p === 90 ? "3M" : p === 180 ? "6M" : "1A"}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={series}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="d" fontSize={10} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <YAxis fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} domain={["dataMin - 1", "dataMax + 1"]} />
            <Tooltip contentStyle={liquidTooltipStyle} />
            <Line type="monotone" dataKey="w" name="Poids" stroke="var(--primary)" strokeWidth={2.5} dot={liquidDot("var(--primary)")} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="muscle" name="Muscle %" stroke="var(--chart-2)" strokeWidth={2} dot={liquidDot("var(--chart-2)")} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="fat" name="Gras %" stroke="var(--chart-4)" strokeWidth={2} dot={liquidDot("var(--chart-4)")} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
