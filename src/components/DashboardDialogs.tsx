import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { liquidTooltipStyle } from "@/lib/chart-style";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { Ring } from "@/components/Stat";
import { lastNDays, fmtDay, todayKey, useLocalState } from "@/lib/storage";
import { formatSleepDuration } from "@/lib/sleep-format";
import { useUserGoals } from "@/hooks/use-user-goals";
import { Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";

export type DashDialog = null | "score" | "water" | "kcal" | "sleep" | "weight" | "routine" | "work" | "workout";

type SleepEntry = { hours: number };
type Nutrition = { kcal: number; p: number; c: number; f: number };

/**
 * The dashboard is an aggregate/read-only surface.
 * A dashboard shortcut may navigate to the owning module, but it must never
 * mutate that module's data. This gives every domain one authoritative editor.
 */
export function DashboardDialogs({ open, onOpenChange }: { open: DashDialog; onOpenChange: (v: DashDialog) => void }) {
  const navigate = useNavigate();
  const close = () => onOpenChange(null);

  useEffect(() => {
    if (!open || open === "score") return;

    const destinations: Record<Exclude<DashDialog, null | "score">, string> = {
      water: "/water",
      kcal: "/nutrition",
      sleep: "/sleep",
      weight: "/body",
      routine: "/routine",
      work: "/work",
      workout: "/sport",
    };

    const destination = destinations[open];
    close();
    void navigate({ to: destination });
  }, [open, navigate]);

  return (
    <Dialog open={open === "score"} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-md">
        {open === "score" && <ScoreDetails />}
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
