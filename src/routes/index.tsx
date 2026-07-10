import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Moon, Droplets, Dumbbell, Briefcase, Wallet, TrendingUp, Flame, CheckCircle2, Scale, Sparkles, Footprints, Activity } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, fmtDay, todayKey } from "@/lib/storage";
import { useUserGoals } from "@/hooks/use-user-goals";
import { useHealthToday } from "@/hooks/use-health";
import { DashboardDialogs, type DashDialog } from "@/components/DashboardDialogs";
import { DailyRhythmRing, RhythmLegend, type RhythmMetric } from "@/components/DailyRhythmRing";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Pace" },
      { name: "description", content: "Score quotidien, calories, eau, sommeil, finances, productivité — tout en un coup d'œil." },
    ],
  }),
  component: Dashboard,
});

type SleepEntry = { hours: number };
type Day<T> = Record<string, T>;

function Dashboard() {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DashDialog>(null);
  const [todayLabel, setTodayLabel] = useState("");
  const { data: health } = useHealthToday();
  const [sleep] = useLocalState<Day<SleepEntry>>("lt.sleep", {});
  const [water] = useLocalState<Day<number>>("lt.water", {});
  const goals = useUserGoals();
  const waterGoal = goals.waterMl;
  const [nutrition] = useLocalState<Day<{ kcal: number; p: number; c: number; f: number }>>("lt.nutrition.totals", {});
  const kcalGoal = goals.kcal;
  const [routines] = useLocalState<Day<string[]>>("lt.routine.done", {});
  const [allRoutines] = useLocalState<Array<{ id: string; name: string }>>("lt.routine.list", []);
  const [work] = useLocalState<Day<number>>("lt.work.minutes", {});
  const [tx] = useLocalState<Array<{ date: string; amount: number; cat: string }>>("lt.tx", []);
  const [weights] = useLocalState<Day<{ w: number }>>("lt.weight", {});

  const today = todayKey();
  const days = lastNDays(7);

  const sleepH = sleep[today]?.hours ?? 0;
  const waterMl = water[today] ?? 0;
  const kcal = nutrition[today]?.kcal ?? 0;
  const routineDoneCount = (routines[today] ?? []).length;
  const routineTotal = allRoutines.length || 1;
  const workMin = work[today] ?? 0;
  const todaySpend = tx.filter((t) => t.date === today && t.amount < 0).reduce((s, t) => s + -t.amount, 0);
  const todayIncome = tx.filter((t) => t.date === today && t.amount > 0).reduce((s, t) => s + t.amount, 0);

  const score = Math.round(
    (Math.min(sleepH / 8, 1) * 20) +
      (Math.min(waterMl / waterGoal, 1) * 15) +
      (Math.min(kcal / kcalGoal, 1) * 15) +
      ((routineDoneCount / Math.max(routineTotal, 1)) * 30) +
      (Math.min(workMin / 240, 1) * 20)
  );

  // Daily Rhythm — concentric rings, colors tuned to the orange→slate→blue backdrop
  const rhythmMetrics: RhythmMetric[] = [
    { key: "sleep",   label: "Sommeil",  value: sleepH,           max: 8,                             unit: "h",   from: "oklch(0.78 0.16 55)",  to: "oklch(0.68 0.19 35)"  },
    { key: "water",   label: "Hydratation", value: waterMl,       max: waterGoal,                     unit: "ml",  from: "oklch(0.78 0.12 220)", to: "oklch(0.6 0.18 250)"  },
    { key: "kcal",    label: "Nutrition", value: kcal,             max: kcalGoal,                     unit: "kcal", from: "oklch(0.78 0.14 145)", to: "oklch(0.6 0.17 175)"  },
    { key: "routine", label: "Routine",  value: routineDoneCount, max: Math.max(routineTotal, 1),                   from: "oklch(0.75 0.15 300)", to: "oklch(0.55 0.2 275)"  },
    { key: "focus",   label: "Focus",    value: workMin,          max: 240,                            unit: "min", from: "oklch(0.72 0.15 20)",  to: "oklch(0.52 0.2 258)"  },
  ];


  const trend = days.map((d) => ({
    day: fmtDay(d).slice(0, 3),
    sommeil: sleep[d]?.hours ?? 0,
    eau: (water[d] ?? 0) / 1000,
    kcal: nutrition[d]?.kcal ?? 0,
  }));

  const weightSeries = lastNDays(30).map((d) => ({ d, w: weights[d]?.w })).filter((x) => x.w);
  const lastWeight = weightSeries.length ? weightSeries[weightSeries.length - 1].w! : null;

  useEffect(() => {
    setTodayLabel(new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));
  }, []);

  return (
    <div>
      <PageHeader
        title="Bonjour 👋"
        subtitle={todayLabel || "Aujourd’hui"}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <motion.button
          type="button"
          onClick={() => setDialog("score")}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          whileTap={{ scale: 0.995 }}
          aria-label="Voir le détail du Daily Rhythm"
          className="text-left lg:col-span-2 glass-card p-6 md:p-8 relative overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {/* soft glow accents tuned to the orange→slate→blue backdrop */}
          <div className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full blur-3xl opacity-60"
               style={{ background: "radial-gradient(closest-side, oklch(0.82 0.16 55 / 0.35), transparent)" }} />
          <div className="pointer-events-none absolute -bottom-24 -right-16 size-72 rounded-full blur-3xl opacity-60"
               style={{ background: "radial-gradient(closest-side, oklch(0.6 0.18 255 / 0.32), transparent)" }} />

          <div className="flex items-center justify-between relative">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Aujourd'hui</div>
              <div className="font-display text-lg md:text-xl font-semibold mt-1">Ton rythme quotidien</div>
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 flex items-center gap-1">
              <Sparkles className="size-3" /> Détail →
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-[auto_1fr] items-center gap-6 md:gap-10 relative">
            <div className="justify-self-center">
              <DailyRhythmRing metrics={rhythmMetrics} score={score} size={244} stroke={12} gap={8} />
            </div>
            <div className="w-full max-w-sm">
              <RhythmLegend metrics={rhythmMetrics} />
            </div>
          </div>
        </motion.button>

        <StatCard
          label="Calories"
          value={kcal}
          unit={`/ ${kcalGoal} kcal`}
          icon={<Flame className="size-4" />}
          onClick={() => setDialog("kcal")}
          hint="Ajouter un apport"
        >
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full stat-grad" style={{ width: `${Math.min(100, (kcal / kcalGoal) * 100)}%` }} />
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            {kcal < kcalGoal ? `${kcalGoal - kcal} kcal restantes` : `+${kcal - kcalGoal} kcal en surplus`}
          </div>
        </StatCard>
      </div>


      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <StatCard label="Sommeil" value={sleepH.toFixed(1)} unit="h" icon={<Moon className="size-4" />} onClick={() => setDialog("sleep")} hint="Modifier" />
        <StatCard label="Eau" value={(waterMl / 1000).toFixed(1)} unit="L" icon={<Droplets className="size-4" />} onClick={() => setDialog("water")} hint="Ajouter" />
        <StatCard label="Routine" value={`${routineDoneCount}/${routineTotal}`} icon={<CheckCircle2 className="size-4" />} onClick={() => navigate({ to: "/routine" })} hint="Ouvrir" />
        <StatCard label="Focus" value={Math.floor(workMin / 60)} unit={`h ${workMin % 60}m`} icon={<Briefcase className="size-4" />} onClick={() => navigate({ to: "/work" })} hint="Ouvrir" />
        <StatCard label="Poids" value={lastWeight ? lastWeight.toFixed(1) : "—"} unit={lastWeight ? "kg" : ""} icon={<Scale className="size-4" />} onClick={() => setDialog("weight")} hint="Peser" />
      </div>

      {(health.steps > 0 || health.kcalActive > 0) && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          <StatCard label="Pas" value={health.steps.toLocaleString()} icon={<Footprints className="size-4" />} onClick={() => navigate({ to: "/settings" })} hint="Montre" />
          <StatCard label="Kcal dépensées" value={health.kcalActive} unit="kcal" icon={<Activity className="size-4" />} onClick={() => navigate({ to: "/settings" })} hint="Montre" />
          <StatCard label={kcal - health.kcalActive >= 0 ? "Surplus" : "Déficit"} value={Math.abs(kcal - health.kcalActive)} unit="kcal" icon={<Flame className="size-4" />} onClick={() => setDialog("kcal")} hint="Détail" />
        </div>
      )}


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-5 shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tendance 7 jours</div>
              <div className="font-display text-lg font-semibold mt-0.5">Sommeil & hydratation</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Area type="monotone" dataKey="sommeil" stroke="var(--primary)" strokeWidth={2} fill="url(#g1)" />
              <Line type="monotone" dataKey="eau" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <button
          type="button"
          onClick={() => navigate({ to: "/finance" })}
          className="text-left rounded-2xl bg-card border border-border p-5 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:border-primary/40 hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Finances du jour</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Ouvrir →</div>
          </div>
          <div className="flex items-center gap-2 text-[color:var(--success)]">
            <TrendingUp className="size-4" />
            <span className="font-display text-2xl font-semibold">+{todayIncome.toFixed(0)}€</span>
          </div>
          <div className="flex items-center gap-2 text-destructive mt-2">
            <Wallet className="size-4" />
            <span className="font-display text-2xl font-semibold">-{todaySpend.toFixed(0)}€</span>
          </div>
          <div className="border-t border-border mt-4 pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net</span>
              <span className={`font-medium ${todayIncome - todaySpend >= 0 ? "text-[color:var(--success)]" : "text-destructive"}`}>
                {(todayIncome - todaySpend).toFixed(2)}€
              </span>
            </div>
          </div>
        </button>
      </div>

      <div className="rounded-2xl bg-card border border-border p-5 shadow-[var(--shadow-soft)] mb-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Heatmap habitudes (90 jours)</div>
        <Heatmap routines={routines} />
      </div>

      {weightSeries.length > 1 && (
        <button
          type="button"
          onClick={() => setDialog("weight")}
          className="w-full text-left rounded-2xl bg-card border border-border p-5 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:border-primary/40 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <Dumbbell className="size-3 inline mr-1" /> Évolution du poids
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Peser →</div>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={weightSeries}>
              <XAxis dataKey="d" hide />
              <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Line type="monotone" dataKey="w" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </button>
      )}

      <DashboardDialogs open={dialog} onOpenChange={setDialog} />
    </div>
  );
}


function Heatmap({ routines }: { routines: Record<string, string[]> }) {
  const navigate = useNavigate();
  const days = lastNDays(91);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex gap-1 overflow-x-auto scrollbar-none">
      {weeks.map((week, i) => (
        <div key={i} className="flex flex-col gap-1">
          {week.map((d) => {
            const c = (routines[d] ?? []).length;
            const intensity = c === 0 ? 0 : Math.min(1, c / 4);
            return (
              <button
                key={d}
                type="button"
                onClick={() => navigate({ to: "/calendar", search: { d } as never })}
                title={`${d} · ${c} habitudes — clique pour voir le détail`}
                className="size-3 rounded-sm hover:ring-2 hover:ring-primary/40 transition-shadow"
                style={{
                  background:
                    intensity === 0
                      ? "var(--muted)"
                      : `color-mix(in oklab, var(--primary) ${intensity * 100}%, var(--muted))`,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
