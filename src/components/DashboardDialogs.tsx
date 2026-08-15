import { useState, useMemo } from "react";
import { liquidTooltipStyle } from "@/lib/chart-style";
import { motion } from "framer-motion";
import { Droplets, Flame, Moon, Scale, Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { Ring } from "@/components/Stat";
import { lastNDays, fmtDay, todayKey, useLocalState } from "@/lib/storage";
import { formatSleepDuration } from "@/lib/sleep-format";
import { useUserGoals } from "@/hooks/use-user-goals";
import { toast } from "sonner";
import { DashboardQuickRoutine, DashboardQuickWork, DashboardQuickWorkout } from "@/components/DashboardQuickActions";

export type DashDialog = null | "score" | "water" | "kcal" | "sleep" | "weight" | "routine" | "work" | "workout";

type SleepEntry = { start?: string; end?: string; hours: number; quality?: number };
type Nutrition = { kcal: number; p: number; c: number; f: number };
type BodyEntry = { w?: number; muscle?: number; fat?: number; waist?: number };

export function DashboardDialogs({ open, onOpenChange }: { open: DashDialog; onOpenChange: (v: DashDialog) => void }) {
  const close = () => onOpenChange(null);
  return (
    <Dialog open={open !== null} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-md">
        {open === "score" && <ScoreDetails />}
        {open === "water" && <WaterQuickAdd onDone={close} />}
        {open === "kcal" && <KcalQuickAdd onDone={close} />}
        {open === "sleep" && <SleepQuickForm onDone={close} />}
        {open === "weight" && <WeightQuickForm onDone={close} />}
        {open === "routine" && <DashboardQuickRoutine onDone={close} />}
        {open === "work" && <DashboardQuickWork onDone={close} />}
        {open === "workout" && <DashboardQuickWorkout onDone={close} />}
      </DialogContent>
    </Dialog>
  );
}

function ScoreDetails() {
  const [sleep] = useLocalState<Record<string, SleepEntry>>("pace.sleep", {});
  const [water] = useLocalState<Record<string, number>>("pace.water", {});
  const [nutrition] = useLocalState<Record<string, Nutrition>>("pace.nutrition.totals", {});
  const [routines] = useLocalState<Record<string, string[]>>("pace.routine.done", {});
  const [allRoutines] = useLocalState<Array<{ id: string; name: string }>>("pace.routine.list", []);
  const [work] = useLocalState<Record<string, number>>("pace.work.minutes", {});
  const goals = useUserGoals();
  const today = todayKey();
  const days = lastNDays(7);

  const computeScore = (d: string) => {
    const s = sleep[d]?.hours ?? 0;
    const w = water[d] ?? 0;
    const k = nutrition[d]?.kcal ?? 0;
    const r = (routines[d] ?? []).length;
    const wm = work[d] ?? 0;
    return Math.round(Math.min(s / 8, 1) * 20 + Math.min(w / goals.waterMl, 1) * 15 + Math.min(k / goals.kcal, 1) * 15 + (r / Math.max(allRoutines.length, 1)) * 30 + Math.min(wm / 240, 1) * 20);
  };

  const todayScore = computeScore(today);
  const history = days.map((d) => ({ day: fmtDay(d).slice(0, 3), score: computeScore(d) }));
  const avg = Math.round(history.reduce((a, b) => a + b.score, 0) / history.length);
  const trend = todayScore - avg;

  const parts = useMemo(() => {
    const s = sleep[today]?.hours ?? 0;
    const w = water[today] ?? 0;
    const k = nutrition[today]?.kcal ?? 0;
    const r = (routines[today] ?? []).length;
    const wm = work[today] ?? 0;
    return [
      { key: "sommeil", label: "Sommeil", pts: Math.round(Math.min(s / 8, 1) * 20), max: 20, detail: `${formatSleepDuration(s)} / 8h` },
      { key: "eau", label: "Hydratation", pts: Math.round(Math.min(w / goals.waterMl, 1) * 15), max: 15, detail: `${(w / 1000).toFixed(1)}L / ${(goals.waterMl / 1000).toFixed(1)}L` },
      { key: "kcal", label: "Nutrition", pts: Math.round(Math.min(k / goals.kcal, 1) * 15), max: 15, detail: `${k} / ${goals.kcal} kcal` },
      { key: "routine", label: "Routine", pts: Math.round((r / Math.max(allRoutines.length, 1)) * 30), max: 30, detail: `${r} / ${Math.max(allRoutines.length, 1)}` },
      { key: "focus", label: "Focus", pts: Math.round(Math.min(wm / 240, 1) * 20), max: 20, detail: `${Math.floor(wm / 60)}h ${wm % 60}m / 4h` },
    ];
  }, [sleep, water, nutrition, routines, work, allRoutines, goals, today]);

  const suggestions = parts.filter((p) => p.pts < p.max).sort((a, b) => (b.max - b.pts) - (a.max - a.pts)).slice(0, 3).map((p) => {
    const map: Record<string, string> = {
      sommeil: `Vise 8h de sommeil ce soir pour +${p.max - p.pts} pts`,
      eau: `Bois encore ${Math.max(0, goals.waterMl - (water[today] ?? 0))} ml d'eau`,
      kcal: `Il te manque ${Math.max(0, goals.kcal - (nutrition[today]?.kcal ?? 0))} kcal`,
      routine: `Complète tes routines pour +${p.max - p.pts} pts`,
      focus: `Ajoute une session de focus (+${p.max - p.pts} pts)`,
    };
    return { key: p.key, text: map[p.key] };
  });

  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;

  return (
    <>
      <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Sparkles className="size-5 text-primary" /> Score quotidien</DialogTitle><DialogDescription>Décomposition, tendance et suggestions.</DialogDescription></DialogHeader>
      <div className="flex items-center gap-5 py-2"><Ring value={todayScore} size={110} stroke={10}><div className="text-center"><div className="font-display text-3xl font-semibold">{todayScore}</div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">/ 100</div></div></Ring><div className="flex-1 space-y-1"><div className="text-xs uppercase tracking-wider text-muted-foreground">Moyenne 7 j</div><div className="font-display text-2xl font-semibold">{avg}</div><div className={`text-xs font-medium flex items-center gap-1 ${trend > 0 ? "text-[color:var(--success)]" : trend < 0 ? "text-destructive" : "text-muted-foreground"}`}><TrendIcon className="size-3.5" />{trend > 0 ? `+${trend}` : trend} vs moyenne</div></div></div>
      <div className="rounded-xl bg-muted/40 p-2"><ResponsiveContainer width="100%" height={80}><LineChart data={history}><YAxis hide domain={[0, 100]} /><Tooltip contentStyle={liquidTooltipStyle} /><Line type="monotone" dataKey="score" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--primary)" }} /></LineChart></ResponsiveContainer></div>
      <div className="space-y-2 pt-2">{parts.map((p) => { const pct = (p.pts / p.max) * 100; return <div key={p.key}><div className="flex justify-between text-xs mb-1"><span className="font-medium">{p.label}</span><span className="text-muted-foreground">{p.pts}/{p.max} · {p.detail}</span></div><div className="h-1.5 rounded-full bg-muted overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7 }} className="h-full bg-gradient-to-r from-primary to-[color:var(--chart-2)]" /></div></div>; })}</div>
      {suggestions.length > 0 && <div className="mt-2 rounded-xl bg-primary/5 border border-primary/20 p-3"><div className="text-xs uppercase tracking-wider text-primary font-medium mb-1.5">Suggestions</div><ul className="text-sm space-y-1">{suggestions.map((s) => <li key={s.key} className="flex gap-2"><span className="text-primary">•</span><span>{s.text}</span></li>)}</ul></div>}
    </>
  );
}

function WaterQuickAdd({ onDone }: { onDone: () => void }) {
  const [water, setWater] = useLocalState<Record<string, number>>("pace.water", {});
  const today = todayKey();
  const current = water[today] ?? 0;
  const goals = useUserGoals();
  const add = (ml: number) => { setWater((p) => ({ ...p, [today]: Math.max(0, (p[today] ?? 0) + ml) })); toast.success(ml >= 0 ? `+${ml} ml` : `${ml} ml`); };
  return <><DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Droplets className="size-5 text-primary" /> Hydratation</DialogTitle><DialogDescription>{current} / {goals.waterMl} ml aujourd'hui</DialogDescription></DialogHeader><div className="grid grid-cols-3 gap-2 py-2">{[150, 250, 330, 500, 750, 1000].map((v) => <Button key={v} variant="secondary" className="rounded-xl" onClick={() => add(v)}>+{v}</Button>)}</div><div className="flex gap-2 pt-2 border-t border-border"><Button variant="ghost" size="sm" onClick={() => add(-250)}>-250 ml</Button><Button variant="ghost" size="sm" onClick={() => { setWater((p) => ({ ...p, [today]: 0 })); toast.success("Reset"); }}>Reset</Button><Button size="sm" className="ml-auto rounded-xl" onClick={onDone}>OK</Button></div></>;
}

function KcalQuickAdd({ onDone }: { onDone: () => void }) {
  const [nutrition, setNutrition] = useLocalState<Record<string, Nutrition>>("pace.nutrition.totals", {});
  const today = todayKey();
  const cur = nutrition[today] ?? { kcal: 0, p: 0, c: 0, f: 0 };
  const goals = useUserGoals();
  const [kcal, setKcal] = useState<number | null>(null);
  const [p, setP] = useState<number | null>(null);
  const [c, setC] = useState<number | null>(null);
  const [f, setF] = useState<number | null>(null);
  const save = () => {
    if (kcal === null && p === null && c === null && f === null) { toast.error("Renseigne au moins une valeur"); return; }
    const next = { kcal: cur.kcal + (kcal ?? 0), p: cur.p + (p ?? 0), c: cur.c + (c ?? 0), f: cur.f + (f ?? 0) };
    setNutrition((prev) => ({ ...prev, [today]: next }));
    const changed = [kcal !== null ? `+${kcal} kcal` : null, p !== null ? `+${p}g prot.` : null, c !== null ? `+${c}g gluc.` : null, f !== null ? `+${f}g lip.` : null].filter(Boolean).join(" · ");
    toast.success(changed); onDone();
  };
  return <><DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Flame className="size-5 text-primary" /> Ajouter un apport</DialogTitle><DialogDescription>{cur.kcal} / {goals.kcal} kcal aujourd'hui · P {cur.p}g · G {cur.c}g · L {cur.f}g</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3 py-2"><div><label className="text-xs text-muted-foreground">Calories</label><NumberField allowDecimal={false} placeholder="ex: 350" value={kcal} onChange={setKcal} /></div><div><label className="text-xs text-muted-foreground">Protéines (g)</label><NumberField allowDecimal={true} placeholder="ex: 30" value={p} onChange={setP} /></div><div><label className="text-xs text-muted-foreground">Glucides (g)</label><NumberField allowDecimal={true} placeholder="ex: 45" value={c} onChange={setC} /></div><div><label className="text-xs text-muted-foreground">Lipides (g)</label><NumberField allowDecimal={true} placeholder="ex: 15" value={f} onChange={setF} /></div></div><div className="flex gap-2 pt-2 border-t border-border"><Button variant="ghost" size="sm" onClick={onDone}>Annuler</Button><Button className="ml-auto rounded-xl" onClick={save}>Ajouter</Button></div></>;
}

function SleepQuickForm({ onDone }: { onDone: () => void }) {
  const [sleep, setSleep] = useLocalState<Record<string, SleepEntry>>("pace.sleep", {});
  const today = todayKey();
  const current = sleep[today];
  const [start, setStart] = useState(current?.start ?? "23:30");
  const [end, setEnd] = useState(current?.end ?? "07:00");
  const [h, setH] = useState<number | null>(null);
  const [quality, setQuality] = useState<number | null>(current?.quality ?? null);
  const diffHours = (a: string, b: string) => { const [ah, am] = a.split(":").map(Number); const [bh, bm] = b.split(":").map(Number); let from = ah + am / 60; let to = bh + bm / 60; if (to < from) to += 24; return Math.max(0, to - from); };
  const save = () => {
    const calculated = diffHours(start, end);
    const v = h === null ? calculated : h;
    if (v < 0 || v > 24) { toast.error("Heures invalides"); return; }
    if (quality !== null && (quality < 1 || quality > 10)) { toast.error("Qualité invalide"); return; }
    setSleep((p) => ({ ...p, [today]: { ...p[today], start, end, hours: v, ...(quality !== null ? { quality } : {}) } }));
    toast.success(`Sommeil : ${formatSleepDuration(v)}`); onDone();
  };
  return <><DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Moon className="size-5 text-primary" /> Sommeil du jour</DialogTitle><DialogDescription>Tous les champs de la page Sommeil sont disponibles ici.</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3 py-2"><div><label className="text-xs text-muted-foreground">Endormi à</label><input type="time" value={start} onChange={(e) => { setStart(e.target.value); setH(null); }} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div><div><label className="text-xs text-muted-foreground">Réveil</label><input type="time" value={end} onChange={(e) => { setEnd(e.target.value); setH(null); }} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div><div><label className="text-xs text-muted-foreground">Durée</label><NumberField step="0.25" min="0" max="24" placeholder="ex: 7.5" value={h} onChange={setH} /><div className="text-[11px] text-muted-foreground mt-1">Affichage : {h !== null ? formatSleepDuration(h) : formatSleepDuration(diffHours(start, end))}</div></div><div><label className="text-xs text-muted-foreground">Qualité (1-10)</label><NumberField allowDecimal={false} min={1} max={10} placeholder="ex: 8" value={quality} onChange={setQuality} /></div></div><div className="flex gap-1.5 flex-wrap">{[6, 6.5, 7, 7.5, 8, 8.5, 9].map((v) => <Button key={v} size="sm" variant="secondary" className="rounded-xl" onClick={() => setH(v)}>{formatSleepDuration(v)}</Button>)}</div><div className="flex gap-2 pt-2 border-t border-border"><Button variant="ghost" size="sm" onClick={onDone}>Annuler</Button><Button className="ml-auto rounded-xl" onClick={save}>Enregistrer</Button></div></>;
}

function WeightQuickForm({ onDone }: { onDone: () => void }) {
  const [weights, setWeights] = useLocalState<Record<string, BodyEntry>>("pace.weight", {});
  const today = todayKey();
  const current = weights[today];
  const [w, setW] = useState<number | null>(current?.w ?? null);
  const [muscle, setMuscle] = useState<number | null>(current?.muscle ?? null);
  const [fat, setFat] = useState<number | null>(current?.fat ?? null);
  const save = () => {
    if (w === null && muscle === null && fat === null) { toast.error("Renseigne au moins une mesure"); return; }
    if (w !== null && (w < 20 || w > 400)) { toast.error("Poids invalide"); return; }
    if (muscle !== null && (muscle < 0 || muscle > 100)) { toast.error("Masse musculaire invalide"); return; }
    if (fat !== null && (fat < 0 || fat > 100)) { toast.error("Masse grasse invalide"); return; }
    setWeights((p) => ({ ...p, [today]: { ...p[today], ...(w !== null ? { w } : {}), ...(muscle !== null ? { muscle } : {}), ...(fat !== null ? { fat } : {}) } }));
    toast.success("Mesures corporelles enregistrées"); onDone();
  };
  return <><DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Scale className="size-5 text-primary" /> Poids & corps</DialogTitle><DialogDescription>Tous les champs corporels disponibles sur la page sont accessibles ici.</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3 py-2"><div><label className="text-xs text-muted-foreground">Poids (kg)</label><NumberField step="0.1" min="0" placeholder="ex: 72.4" value={w} onChange={setW} /></div><div><label className="text-xs text-muted-foreground">Muscle (%)</label><NumberField step="0.1" min="0" max="100" placeholder="ex: 42" value={muscle} onChange={setMuscle} /></div><div><label className="text-xs text-muted-foreground">Gras (%)</label><NumberField step="0.1" min="0" max="100" placeholder="ex: 18" value={fat} onChange={setFat} /></div></div><div className="flex gap-2 pt-2 border-t border-border"><Button variant="ghost" size="sm" onClick={onDone}>Annuler</Button><Button className="ml-auto rounded-xl" onClick={save}>Enregistrer</Button></div></>;
}
