import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { liquidTooltipStyle, liquidDot } from "@/lib/chart-style";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Moon, Droplets, Dumbbell, Briefcase, Wallet, TrendingUp, Flame, CheckCircle2, Scale, Sparkles, Footprints, Activity } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, fmtDay, todayKey } from "@/lib/storage";
import { useUserGoals } from "@/hooks/use-user-goals";
import { useHealthToday } from "@/hooks/use-health";
import { DashboardDialogs, type DashDialog } from "@/components/DashboardDialogs";
import { DailyRhythmRing, type RhythmMetric } from "@/components/DailyRhythmRing";
import { DailyInsight } from "@/components/DailyInsight";
import { WeeklyHabits } from "@/components/WeeklyHabits";
import { SmartCard } from "@/components/SmartCard";
import { buildIntel, statusColor, type ModuleKey } from "@/lib/insights";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>) => ({
    quickAdd: (["water", "kcal", "sleep", "weight", "workout"] as const).includes(s.quickAdd as never)
      ? (s.quickAdd as "water" | "kcal" | "sleep" | "weight" | "workout")
      : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Pace — votre centre de contrôle quotidien" },
      { name: "description", content: "Un dashboard intelligent : rythme quotidien expliqué, insights contextuels, hydratation, nutrition, sommeil, focus et finances en un coup d'œil." },
      { property: "og:title", content: "Pace — votre centre de contrôle quotidien" },
      { property: "og:description", content: "Insights contextuels, score de rythme expliqué et actions rapides pour piloter votre journée." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type SleepEntry = { hours: number };
type Day<T> = Record<string, T>;

const ICONS: Record<ModuleKey, React.ReactNode> = {
  sleep: <Moon className="size-4" />,
  water: <Droplets className="size-4" />,
  kcal: <Flame className="size-4" />,
  routine: <CheckCircle2 className="size-4" />,
  focus: <Briefcase className="size-4" />,
  weight: <Scale className="size-4" />,
  finance: <Wallet className="size-4" />,
};

function Dashboard() {
  const navigate = useNavigate();
  const { quickAdd } = Route.useSearch();
  const [dialog, setDialog] = useState<DashDialog>(null);

  useEffect(() => {
    if (!quickAdd) return;
    setDialog(quickAdd);
    navigate({ to: "/", search: {}, replace: true });
  }, [quickAdd, navigate]);

  const [todayLabel, setTodayLabel] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const { data: health } = useHealthToday();
  const [sleep] = useLocalState<Day<SleepEntry>>("pace.sleep", {});
  const [water, setWater] = useLocalState<Day<number>>("pace.water", {});
  const [waterLog, setWaterLog] = useLocalState<Day<number[]>>("pace.water.log", {});
  const goals = useUserGoals();
  const [nutrition] = useLocalState<Day<{ kcal: number; p: number; c: number; f: number }>>("pace.nutrition.totals", {});
  const [routines] = useLocalState<Day<string[]>>("pace.routine.done", {});
  const [allRoutines] = useLocalState<Array<{ id: string; name: string }>>("pace.routine.list", []);
  const [work] = useLocalState<Day<number>>("pace.work.minutes", {});
  const [tx] = useLocalState<Array<{ date: string; amount: number; cat: string }>>("pace.tx", []);
  const [weights] = useLocalState<Day<{ w: number }>>("pace.weight", {});

  const today = todayKey();
  const days = useMemo(() => lastNDays(7), []);

  useEffect(() => {
    setNow(new Date());
    setTodayLabel(new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const intel = useMemo(
    () =>
      buildIntel({
        days,
        today,
        now: now ?? new Date(`${today}T09:00:00`),
        sleep,
        water,
        waterLog,
        nutrition,
        routineDone: routines,
        routineTotal: allRoutines.length,
        work,
        weights,
        tx,
        goals: { kcal: goals.kcal, waterMl: goals.waterMl, weightGoalKg: goals.weightGoalKg },
        steps: health.steps,
        kcalActive: health.kcalActive,
      }),
    [days, today, now, sleep, water, waterLog, nutrition, routines, allRoutines, work, weights, tx, goals, health],
  );

  const sleepH = sleep[today]?.hours ?? 0;
  const waterMl = water[today] ?? 0;
  const kcal = nutrition[today]?.kcal ?? 0;
  const routineDoneCount = (routines[today] ?? []).length;
  const routineTotal = allRoutines.length || 1;
  const workMin = work[today] ?? 0;
  const todaySpend = tx.filter((t) => t.date === today && t.amount < 0).reduce((s, t) => s + -t.amount, 0);
  const todayIncome = tx.filter((t) => t.date === today && t.amount > 0).reduce((s, t) => s + t.amount, 0);

  const rhythmMetrics: RhythmMetric[] = useMemo(
    () => [
      { key: "sleep", label: "Sommeil", value: sleepH, max: 8, unit: "h", from: "oklch(0.78 0.16 55)", to: "oklch(0.68 0.19 35)" },
      { key: "water", label: "Hydratation", value: waterMl, max: goals.waterMl, unit: "ml", from: "oklch(0.78 0.12 220)", to: "oklch(0.6 0.18 250)" },
      { key: "kcal", label: "Nutrition", value: kcal, max: goals.kcal, unit: "kcal", from: "oklch(0.78 0.14 145)", to: "oklch(0.6 0.17 175)" },
      { key: "routine", label: "Routine", value: routineDoneCount, max: routineTotal, from: "oklch(0.75 0.15 300)", to: "oklch(0.55 0.2 275)" },
      { key: "focus", label: "Focus", value: workMin, max: 240, unit: "min", from: "oklch(0.72 0.15 20)", to: "oklch(0.52 0.2 258)" },
    ],
    [sleepH, waterMl, kcal, routineDoneCount, routineTotal, workMin, goals.waterMl, goals.kcal],
  );

  const trend = useMemo(
    () =>
      days.map((d) => ({
        day: fmtDay(d).slice(0, 3),
        sommeil: sleep[d]?.hours ?? 0,
        eau: (water[d] ?? 0) / 1000,
        kcal: nutrition[d]?.kcal ?? 0,
      })),
    [days, sleep, water, nutrition],
  );

  const weightSeries = useMemo(
    () => lastNDays(30).map((d) => ({ d, w: weights[d]?.w })).filter((x) => x.w),
    [weights],
  );

  const addWater = useCallback(() => {
    setWater((p) => ({ ...p, [today]: (p[today] ?? 0) + 250 }));
    setWaterLog((p) => ({ ...p, [today]: [...(p[today] ?? []), Date.now()] }));
    toast.success("+250 ml d'eau");
  }, [setWater, setWaterLog, today]);

  const quickFor = useCallback(
    (key: ModuleKey): { open: () => void; add?: () => void; label?: string } => {
      switch (key) {
        case "water": return { open: () => setDialog("water"), add: addWater, label: "250 ml" };
        case "kcal": return { open: () => setDialog("kcal"), add: () => setDialog("kcal"), label: "Repas" };
        case "sleep": return { open: () => setDialog("sleep"), add: () => setDialog("sleep"), label: "Nuit" };
        case "weight": return { open: () => setDialog("weight"), add: () => setDialog("weight"), label: "Pesée" };
        case "routine": return { open: () => navigate({ to: "/routine" }), add: () => navigate({ to: "/routine" }), label: "Habitude" };
        case "focus": return { open: () => navigate({ to: "/work" }), add: () => navigate({ to: "/work" }), label: "Session" };
        case "finance": return { open: () => navigate({ to: "/finance" }), add: () => navigate({ to: "/finance" }), label: "Dépense" };
      }
    },
    [addWater, navigate],
  );

  return (
    <div>
      <PageHeader title={`${intel.greeting} 👋`} subtitle={todayLabel || "Aujourd’hui"} a11yLabel="Tableau de bord Pace" />

      <div className="flex flex-wrap gap-2 mb-4">
        {([
          { icon: <Droplets className="size-3.5" />, label: "Eau", action: () => setDialog("water") },
          { icon: <Flame className="size-3.5" />, label: "Repas", action: () => setDialog("kcal") },
          { icon: <Moon className="size-3.5" />, label: "Sommeil", action: () => setDialog("sleep") },
          { icon: <Scale className="size-3.5" />, label: "Pesée", action: () => setDialog("weight") },
          { icon: <Dumbbell className="size-3.5" />, label: "Séance", action: () => setDialog("workout") },
        ] as const).map((a) => (
          <button key={a.label} onClick={a.action} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-thin text-xs font-medium hover:opacity-80 transition">
            {a.icon} + {a.label}
          </button>
        ))}
      </div>

      <DailyInsight intel={intel} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <motion.button type="button" onClick={() => setDialog("score")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} whileTap={{ scale: 0.995 }} aria-label="Voir le détail du Daily Rhythm" className="text-left lg:col-span-2 glass-card p-6 md:p-8 relative overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <div className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full blur-3xl opacity-60" style={{ background: "radial-gradient(closest-side, oklch(0.82 0.16 55 / 0.35), transparent)" }} />
          <div className="pointer-events-none absolute -bottom-24 -right-16 size-72 rounded-full blur-3xl opacity-60" style={{ background: "radial-gradient(closest-side, oklch(0.6 0.18 255 / 0.32), transparent)" }} />
          <div className="flex items-center justify-between relative">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Aujourd'hui</div>
              <div className="font-display text-lg md:text-xl font-semibold mt-1">Ton rythme quotidien</div>
              <div className="text-xs text-muted-foreground mt-1">{intel.rhythmSummary}{intel.scoreAvg > 0 && <> · {intel.scoreDelta >= 0 ? "↑ +" : "↓ −"}{Math.abs(intel.scoreDelta)} pts vs ta moyenne</>}</div>
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 flex items-center gap-1"><Sparkles className="size-3" /> Détail →</div>
          </div>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-[auto_1fr] items-center gap-6 md:gap-10 relative">
            <div className="justify-self-center"><DailyRhythmRing metrics={rhythmMetrics} score={intel.score} size={244} stroke={12} gap={8} /></div>
            <ul className="w-full max-w-sm space-y-2">{intel.rhythmLines.map((l) => <li key={l.label} className="flex items-start gap-2.5"><span className="mt-1.5 size-1.5 rounded-full shrink-0" style={{ background: statusColor[l.status] }} /><div className="min-w-0"><div className="text-[13px] font-medium leading-tight">{l.label}</div><div className="text-[11px] text-muted-foreground leading-snug">{l.text}</div></div></li>)}</ul>
          </div>
        </motion.button>
        <SmartCard metric={intel.metrics.find((m) => m.key === "kcal")!} icon={ICONS.kcal} onOpen={() => setDialog("kcal")} onQuickAdd={() => setDialog("kcal")} quickLabel="Repas" />
      </div>

      <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {intel.metrics.filter((m) => m.key !== "kcal").map((m) => {
          const q = quickFor(m.key);
          return <SmartCard key={m.key} metric={m} icon={ICONS[m.key]} onOpen={q.open} onQuickAdd={q.add} quickLabel={q.label} />;
        })}
      </motion.div>

      {(health.steps > 0 || health.kcalActive > 0) && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          <StatCard label="Pas" value={health.steps.toLocaleString()} icon={<Footprints className="size-4" />} onClick={() => navigate({ to: "/settings" })} hint="Montre" />
          <StatCard label="Kcal dépensées" value={health.kcalActive} unit="kcal" icon={<Activity className="size-4" />} onClick={() => navigate({ to: "/settings" })} hint="Montre" />
          <StatCard label={kcal - health.kcalActive >= 0 ? "Surplus" : "Déficit"} value={Math.abs(kcal - health.kcalActive)} unit="kcal" icon={<Flame className="size-4" />} onClick={() => setDialog("kcal")} hint="Détail" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 rounded-2xl glass-card p-5">
          <div className="flex items-center justify-between mb-3"><div><div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tendance 7 jours</div><div className="font-display text-lg font-semibold mt-0.5">Sommeil & hydratation</div></div></div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient>
                <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
              </defs>
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} /><YAxis hide /><Tooltip contentStyle={liquidTooltipStyle} />
              <Area type="monotone" dataKey="sommeil" stroke="var(--primary)" strokeWidth={2} fill="url(#g1)" dot={liquidDot("var(--primary)")} activeDot={{ r: 5 }} connectNulls={false} />
              <Area type="monotone" dataKey="eau" stroke="var(--chart-2)" strokeWidth={2} fill="url(#g2)" dot={liquidDot("var(--chart-2")} activeDot={{ r: 5 }} connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <button type="button" onClick={() => navigate({ to: "/finance" })} className="text-left rounded-2xl glass-card p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
          <div className="flex items-center justify-between mb-3"><div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Finances du jour</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Ouvrir →</div></div>
          <div className="flex items-center gap-2 text-[color:var(--success)]"><TrendingUp className="size-4" /><span className="font-display text-2xl font-semibold">+{todayIncome.toFixed(0)}€</span></div>
          <div className="flex items-center gap-2 text-destructive mt-2"><Wallet className="size-4" /><span className="font-display text-2xl font-semibold">-{todaySpend.toFixed(0)}€</span></div>
          <div className="border-t border-border mt-4 pt-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Net</span><span className={`font-medium ${todayIncome - todaySpend >= 0 ? "text-[color:var(--success)]" : "text-destructive"}`}>{(todayIncome - todaySpend).toFixed(2)}€</span></div></div>
        </button>
      </div>

      <WeeklyHabits routines={routines} total={allRoutines.length} />

      {weightSeries.length > 1 && (
        <button type="button" onClick={() => setDialog("weight")} className="w-full text-left rounded-2xl glass-card p-5 hover:shadow-[var(--shadow-card)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
          <div className="flex items-center justify-between mb-3"><div className="text-xs font-medium text-muted-foreground uppercase tracking-wider"><Dumbbell className="size-3 inline mr-1" /> Évolution du poids</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Peser →</div></div>
          <ResponsiveContainer width="100%" height={140}><LineChart data={weightSeries}><XAxis dataKey="d" hide /><YAxis hide domain={["dataMin - 1", "dataMax + 1"]} /><Tooltip contentStyle={liquidTooltipStyle} /><Line type="monotone" dataKey="w" stroke="var(--primary)" strokeWidth={2.5} dot={liquidDot("var(--primary)")} activeDot={{ r: 5 }} connectNulls={false} /></LineChart></ResponsiveContainer>
        </button>
      )}

      <DashboardDialogs open={dialog} onOpenChange={setDialog} />
    </div>
  );
}
