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

function BodyPage() {
  const [data, setData] = useLocalState<Record<string, Entry>>("lt.weight", {});
  const [w, setW] = useState("");
  const [muscle, setMuscle] = useState("");
  const [fat, setFat] = useState("");
  const [period, setPeriod] = useState(30);

  const days = lastNDays(period);
  const series = days.map((d) => ({ d: d.slice(5), ...data[d] }));
  const valid = series.filter((x) => x.w);
  const min = valid.length ? Math.min(...valid.map((x) => x.w!)) : 0;
  const max = valid.length ? Math.max(...valid.map((x) => x.w!)) : 0;
  const avg = valid.length ? valid.reduce((s, x) => s + x.w!, 0) / valid.length : 0;
  const first = valid[0]?.w;
  const last = valid[valid.length - 1]?.w;
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
          <div className="font-display text-lg font-semibold">Évolution</div>
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
