import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";

export type RhythmMetric = {
  key: string;
  label: string;
  value: number;
  max: number;
  /** two-stop gradient for the ring stroke */
  from: string;
  to: string;
  unit?: string;
};

/**
 * Daily Rhythm — concentric Apple Activity–style rings.
 * Ultra-minimal, iOS-native. Sits inside a `.glass-card` container.
 * Uses SVG stroke-dashoffset animated by framer-motion (GPU-composited, 60fps).
 */
export function DailyRhythmRing({
  metrics,
  score,
  size = 260,
  gap = 10,
  stroke = 14,
}: {
  metrics: RhythmMetric[];
  score: number;
  size?: number;
  gap?: number;
  stroke?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        style={{ willChange: "transform" }}
      >
        <defs>
          {metrics.map((m, i) => (
            <linearGradient key={m.key} id={`${uid}-g-${i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={m.from} />
              <stop offset="100%" stopColor={m.to} />
            </linearGradient>
          ))}
        </defs>

        {metrics.map((m, i) => {
          const r = (size - stroke) / 2 - i * (stroke + gap);
          if (r <= stroke) return null;
          const c = 2 * Math.PI * r;
          const pct = Math.max(0, Math.min(1, m.value / Math.max(m.max, 1)));
          const target = c * (1 - pct);
          return (
            <g key={m.key}>
              {/* track */}
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke="color-mix(in oklab, currentColor 8%, transparent)"
                strokeWidth={stroke}
              />
              {/* progress */}
              <motion.circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={`url(#${uid}-g-${i})`}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={c}
                initial={reduce ? { strokeDashoffset: target } : { strokeDashoffset: c }}
                animate={{ strokeDashoffset: target }}
                transition={{ duration: reduce ? 0 : 1.1, ease: [0.22, 1, 0.36, 1], delay: i * 0.08 }}
                style={{ willChange: "stroke-dashoffset" }}
              />
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80">Daily Rhythm</div>
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            className="font-display text-5xl font-semibold tracking-tight tabular-nums mt-1"
          >
            {Math.round(score)}
          </motion.div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mt-0.5">/ 100</div>
        </div>
      </div>
    </div>
  );
}

export function RhythmLegend({ metrics }: { metrics: RhythmMetric[] }) {
  return (
    <ul className="space-y-2.5">
      {metrics.map((m) => {
        const pct = Math.round(Math.min(100, (m.value / Math.max(m.max, 1)) * 100));
        return (
          <li key={m.key} className="flex items-center gap-3">
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{ background: `linear-gradient(135deg, ${m.from}, ${m.to})` }}
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-foreground/90 truncate">{m.label}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatValue(m.value, m.unit)}
                  <span className="opacity-50"> / {formatValue(m.max, m.unit)}</span>
                </span>
              </div>
              <div className="h-1 rounded-full bg-foreground/5 overflow-hidden mt-1">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${m.from}, ${m.to})` }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function formatValue(v: number, unit?: string) {
  const n = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${n}${unit ? ` ${unit}` : ""}`;
}
