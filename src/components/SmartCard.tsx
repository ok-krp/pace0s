import { memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { Sparkline } from "@/components/Sparkline";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { springSnap, interactiveRing } from "@/lib/motion";
import { statusColor, type SmartMetric } from "@/lib/insights";

/**
 * Carte « vivante » du dashboard : valeur + contexte + micro-visualisations
 * + action rapide, sans augmenter la taille de la carte.
 */
function SmartCardBase({
  metric,
  icon,
  onOpen,
  onQuickAdd,
  quickLabel,
}: {
  metric: SmartMetric;
  icon: ReactNode;
  onOpen: () => void;
  onQuickAdd?: () => void;
  quickLabel?: string;
}) {
  const color = statusColor[metric.status];
  const numeric = Number(metric.value.replace(",", "."));
  const isNumeric = Number.isFinite(numeric) && !metric.value.includes("/");
  const digits = metric.value.includes(".") ? 1 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, scale: 1.008 }}
      transition={springSnap}
      className="relative glass-card p-5 will-change-transform"
      layout="position"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${metric.label} — voir le détail`}
        className={`text-left w-full ${interactiveRing} rounded-2xl`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{metric.label}</div>
          <div
            className="glass-icon size-8 rounded-xl shrink-0"
            style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
          >
            {icon}
          </div>
        </div>

        <div className="mt-2.5 flex items-end justify-between gap-2">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <div className="font-display text-[28px] leading-none font-semibold tracking-tight">
              {isNumeric ? <AnimatedNumber value={numeric} digits={digits} /> : metric.value}
            </div>
            {metric.unit && <div className="text-xs text-muted-foreground truncate">{metric.unit}</div>}
          </div>
          <Sparkline data={metric.spark} color={color} width={78} height={24} />
        </div>

        <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "color-mix(in oklab, var(--foreground) 8%, transparent)" }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${color} 70%, transparent), ${color})` }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(metric.pct * 100)}%` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>

        <div className="mt-2.5 text-xs font-medium" style={{ color }}>
          {metric.context}
        </div>
        <ul className="mt-1 space-y-0.5">
          {metric.detail.map((d) => (
            <li key={d} className="text-[11px] text-muted-foreground leading-snug">{d}</li>
          ))}
        </ul>
      </button>

      {(metric.badge || onQuickAdd) && (
        <div className="mt-3 flex items-center gap-2">
          {metric.badge && (
            <motion.span
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={springSnap}
              className="glass-thin rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide"
            >
              {metric.badge}
            </motion.span>
          )}
          {onQuickAdd && (
            <motion.button
              type="button"
              onClick={onQuickAdd}
              whileTap={{ scale: 0.94 }}
              transition={springSnap}
              aria-label={quickLabel ?? `Ajouter ${metric.label}`}
              className={`ml-auto glass-thin rounded-full pl-2 pr-3 py-1 text-[11px] font-medium flex items-center gap-1 ${interactiveRing}`}
            >
              <Plus className="size-3" />
              {quickLabel ?? "Ajouter"}
            </motion.button>
          )}
        </div>
      )}
    </motion.div>
  );
}

export const SmartCard = memo(SmartCardBase);
