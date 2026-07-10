import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Moon, Droplets, Dumbbell, Briefcase, Wallet, TrendingUp, Flame, CheckCircle2, Scale, Sparkles, Footprints, Activity } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";
import { PageHeader, Ring, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays, fmtDay, todayKey } from "@/lib/storage";
import { useUserGoals } from "@/hooks/use-user-goals";
import { useHealthToday } from "@/hooks/use-health";
import { DashboardDialogs, type DashDialog } from "@/components/DashboardDialogs";

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

  const trend = days.map((d) => ({
    day: fmtDay(d).slice(0, 3),
    sommeil: sleep[d]?.hours ?? 0,
    eau: (water[d] ?? 0) / 1000,
    kcal: nutrition[d]?.kcal ?? 0,
  }));

  const weightSeries = lastNDays(30).map((d) => ({ d, w: weights[d]?.w })).filter((x) => x.w);
  const lastWeight = weightSeries.length ? weightSeries[weightSeries.length - 1].w! : null;

  return (
    <div>
      <PageHeader
        title="Bonjour 👋"
        subtitle={new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <motion.button
          type="button"
          onClick={() => setDialog("score")}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.99 }}
          aria-label="Voir le détail du score quotidien"
          className="text-left lg:col-span-2 rounded-2xl p-6 stat-grad text-primary-foreground shadow-[var(--shadow-glow)] relative overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/10 blur-3xl group-hover:bg-white/15 transition-colors" />
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest opacity-80">Score quotidien</div>
            <div className="text-[10px] uppercase tracking-widest opacity-80 flex items-center gap-1">
              <Sparkles className="size-3" /> Détails →
            </div>
          </div>
          <div className="mt-3 flex items-end gap-6">
            <Ring value={score} size={120} stroke={11} color="white">
              <div className="text-center">
                <div className="font-display text-3xl font-semibold">{score}</div>
                <div className="text-[10px] uppercase tracking-wider opacity-80">/ 100</div>
              </div>
            </Ring>
            <div className="flex-1 space-y-1.5 text-sm">
              <Bar label="Sommeil" v={sleepH} max={8} unit="h" />
              <Bar label="Eau" v={waterMl} max={waterGoal} unit="ml" />
              <Bar label="Routine" v={routineDoneCount} max={Math.max(routineTotal, 1)} unit="" />
              <Bar label="Focus" v={workMin} max={240} unit="min" />
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

function Bar({ label, v, max, unit }: { label: string; v: number; max: number; unit: string }) {
  const pct = Math.min(100, (v / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-[11px] opacity-90">
        <span>{label}</span>
        <span>
          {v.toFixed(unit === "h" ? 1 : 0)} {unit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/20 overflow-hidden mt-1">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full bg-white rounded-full"
        />
      </div>
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
