import { motion, useReducedMotion } from "framer-motion";
import { Activity, Droplets, Flame, Briefcase, Moon, CheckCircle2 } from "lucide-react";

export type RhythmMetric = { key: string; label: string; value: number; max: number; from: string; to: string; unit?: string };

const ICONS: Record<string, typeof Activity> = { sleep: Moon, water: Droplets, kcal: Flame, routine: CheckCircle2, focus: Briefcase };

/** Compact Daily Rhythm score: icons and progress, without concentric circles. */
export function DailyRhythmRing({ metrics, score }: { metrics: RhythmMetric[]; score: number; size?: number; gap?: number; stroke?: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="w-full max-w-sm space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80">Daily Rhythm</div><motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.6 }} className="font-display text-5xl font-bold tracking-tight tabular-nums mt-1">{Math.round(score)}</motion.div></div>
        <Activity className="size-6 text-primary" aria-hidden="true" />
      </div>
      <div className="grid grid-cols-5 gap-3">
        {metrics.map((m) => { const Icon = ICONS[m.key] ?? Activity; const pct = Math.round(Math.min(100, (m.value / Math.max(m.max, 1)) * 100)); return <div key={m.key} className="min-w-0"><Icon className="size-4 text-primary mb-1.5" aria-hidden="true" /><div className="text-[10px] text-muted-foreground truncate">{m.label}</div><div className="mt-1 h-1 bg-foreground/8 overflow-hidden rounded-sm"><motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: reduce ? 0 : 0.7 }} className="h-full" style={{ background: `linear-gradient(90deg, ${m.from}, ${m.to})` }} /></div></div>; })}
      </div>
    </div>
  );
}

export function RhythmLegend({ metrics }: { metrics: RhythmMetric[] }) {
  return <ul className="space-y-2.5">{metrics.map((m) => { const Icon = ICONS[m.key] ?? Activity; const pct = Math.round(Math.min(100, (m.value / Math.max(m.max, 1)) * 100)); return <li key={m.key} className="flex items-center gap-3"><Icon className="size-4 text-primary shrink-0" aria-hidden="true" /><div className="flex-1 min-w-0"><div className="flex items-baseline justify-between gap-2"><span className="text-xs font-medium text-foreground/90 truncate">{m.label}</span><span className="text-[11px] font-bold text-muted-foreground tabular-nums">{formatValue(m.value, m.unit)}<span className="opacity-50"> / {formatValue(m.max, m.unit)}</span></span></div><div className="h-1 bg-foreground/5 overflow-hidden mt-1"><div className="h-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${m.from}, ${m.to})` }} /></div></div></li>; })}</ul>;
}
function formatValue(v: number, unit?: string) { const n = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10; return `${n}${unit ? ` ${unit}` : ""}`; }
