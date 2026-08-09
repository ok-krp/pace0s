import { useState } from "react";
import { liquidTooltipStyle } from "@/lib/chart-style";
import { Droplets, Plus, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Ring, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, fmtDay, todayKey } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUserGoals } from "@/hooks/use-user-goals";

type Unit = "ml" | "cl" | "L";
const TO_ML: Record<Unit, number> = { ml: 1, cl: 10, L: 1000 };

export function WaterView() {
  const [data, setData] = useLocalState<Record<string, number>>("pace.water", {});
  const goals = useUserGoals();
  const goal = goals.waterMl;
  const today = todayKey();
  const cur = data[today] ?? 0;
  const [manual, setManual] = useState("");
  const [unit, setUnit] = useState<Unit>("ml");

  const add = (ml: number) => setData((p) => ({ ...p, [today]: Math.max(0, (p[today] ?? 0) + ml) }));
  const addManual = () => {
    const v = parseFloat(manual.replace(",", "."));
    if (!v || isNaN(v)) return;
    add(Math.round(v * TO_ML[unit]));
    setManual("");
  };

  const days = lastNDays(14);
  const series = days.map((d) => ({ day: fmtDay(d).slice(0, 3), ml: data[d] ?? 0 }));
  const avg = series.reduce((s, x) => s + x.ml, 0) / series.length;
  const best = series.reduce((b, x) => (x.ml > b ? x.ml : b), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 rounded-2xl glass-card p-6 flex flex-col items-center">
        <Ring value={cur} max={goal} size={180} stroke={14} color="var(--chart-2)">
          <div className="text-center">
            <div className="font-display text-3xl font-semibold">{(cur / 1000).toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">/ {(goal / 1000).toFixed(1)} L</div>
          </div>
        </Ring>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {[150, 250, 500].map((v) => (
            <Button key={v} variant="secondary" onClick={() => add(v)} className="rounded-xl">
              <Plus className="size-3 mr-1" /> {v} ml
            </Button>
          ))}
          <Button variant="ghost" onClick={() => add(-250)} className="rounded-xl"><Minus className="size-3" /></Button>
        </div>
        <div className="mt-4 w-full flex gap-2">
          <Input type="number" inputMode="decimal" placeholder="Quantité" value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addManual(); }}
            className="flex-1" />
          <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
            <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ml">ml</SelectItem>
              <SelectItem value="cl">cl</SelectItem>
              <SelectItem value="L">L</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={addManual} className="rounded-xl">OK</Button>
        </div>
        <div className="text-xs text-muted-foreground mt-3">Objectif : {(goal / 1000).toFixed(2)} L</div>
      </div>
      <div className="lg:col-span-2 grid grid-cols-2 gap-4">
        <StatCard label="Moyenne 14j" value={(avg / 1000).toFixed(1)} unit="L" icon={<Droplets className="size-4" />} />
        <StatCard label="Meilleur" value={(best / 1000).toFixed(1)} unit="L" />
        <div className="col-span-2 rounded-2xl glass-card p-5">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Historique</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={series}>
              <XAxis dataKey="day" fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={liquidTooltipStyle} />
              <Bar dataKey="ml" fill="var(--chart-2)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
