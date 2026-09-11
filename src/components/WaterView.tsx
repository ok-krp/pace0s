import { useState } from "react";
import { Droplets, Plus, Minus } from "lucide-react";
import { Ring } from "@/components/Stat";
import { todayKey } from "@/lib/storage";
import { useDomainState } from "@/lib/domain-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUserGoals } from "@/hooks/use-user-goals";

type Unit = "ml" | "cl" | "L";
const TO_ML: Record<Unit, number> = { ml: 1, cl: 10, L: 1000 };
type WaterData = Record<string, number>;

export function WaterView() {
  const [data, setData] = useDomainState<WaterData>("water", {});
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

  return (
    <div className="rounded-2xl glass-card p-4 sm:p-5 flex h-full w-full max-w-[360px] mx-auto flex-col items-center">
      <Ring value={cur} max={goal} size={148} stroke={12} color="var(--chart-2)">
        <div className="text-center">
          <div className="font-display text-2xl font-semibold">{(cur / 1000).toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">/ {(goal / 1000).toFixed(1)} L</div>
        </div>
      </Ring>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {[150, 250, 500].map((v) => (
          <Button key={v} variant="secondary" onClick={() => add(v)} className="rounded-xl h-8 px-2.5 text-xs">
            <Plus className="size-3 mr-1" /> {v} ml
          </Button>
        ))}
        <Button variant="ghost" onClick={() => add(-250)} className="rounded-xl h-8 w-8 p-0"><Minus className="size-3" /></Button>
      </div>
      <div className="mt-3 w-full flex gap-1.5">
        <Input type="number" inputMode="decimal" placeholder="Quantité" value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addManual(); }}
          className="h-9 flex-1 min-w-0 text-sm" />
        <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
          <SelectTrigger className="h-9 w-[4.25rem] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ml">ml</SelectItem>
            <SelectItem value="cl">cl</SelectItem>
            <SelectItem value="L">L</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={addManual} className="rounded-xl h-9 px-3 text-xs">OK</Button>
      </div>
      <div className="text-xs text-muted-foreground mt-2">Objectif : {(goal / 1000).toFixed(2)} L</div>
    </div>
  );
}
