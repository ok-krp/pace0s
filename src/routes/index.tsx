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
  validateSearch: (s: Record<string, unknown>) => {
    const quickAdd = (["water", "kcal", "sleep", "weight", "workout"] as const).includes(s.quickAdd as never)
      ? (s.quickAdd as "water" | "kcal" | "sleep" | "weight" | "workout")
      : undefined;
    return quickAdd === undefined ? undefined : { quickAdd };
  },
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
  const search = Route.useSearch();
  const quickAdd = search?.quickAdd;
  const [dialog, setDialog] = useState<DashDialog>(null);

  useEffect(() => {
    if (!quickAdd) return;
    setDialog(quickAdd);
    navigate({ to: "/", search: undefined, replace: true });
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
