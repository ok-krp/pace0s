import { motion } from "framer-motion";
import { ReactNode } from "react";
import { springSoft, springSnap, interactiveRing } from "@/lib/motion";

export function StatCard({
  label,
  value,
  unit,
  delta,
  icon,
  accent,
  children,
  onClick,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: number;
  icon?: ReactNode;
  accent?: string;
  children?: ReactNode;
  onClick?: () => void;
  hint?: string;
}) {
  const positive = delta !== undefined && delta >= 0;
  const interactive = !!onClick;
  const className =
    "text-left w-full glass-card p-5 transition-all " +
    (interactive
      ? "hover:-translate-y-0.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      : "");

  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
        {icon && (
          <div
            className="size-8 rounded-lg grid place-items-center text-primary shrink-0"
            style={{ background: accent ?? "color-mix(in oklab, var(--primary) 12%, transparent)" }}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <div className="font-display text-3xl font-semibold tracking-tight">{value}</div>
        {unit && <div className="text-sm text-muted-foreground">{unit}</div>}
      </div>
      {delta !== undefined && (
        <div className={`mt-1 text-xs font-medium ${positive ? "text-[color:var(--success)]" : "text-destructive"}`}>
          {positive ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}%
        </div>
      )}
      {children && <div className="mt-3">{children}</div>}
      {interactive && hint && (
        <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">{hint} →</div>
      )}
    </>
  );

  if (interactive) {
    return (
      <motion.button
        type="button"
        onClick={onClick}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2, scale: 1.005 }}
        whileTap={{ scale: 0.975 }}
        transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.6 }}
        aria-label={`${label} — ${hint ?? "ouvrir"}`}
        className={className}
      >
        {inner}
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 28, mass: 0.7 }}
      className={className}
    >
      {inner}
    </motion.div>
  );
}

export function Ring({
  value,
  max = 100,
  size = 88,
  stroke = 9,
  color = "var(--primary)",
  children,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--muted)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
