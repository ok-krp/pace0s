import { memo } from "react";
import { motion } from "framer-motion";
import { Sparkles, Trophy } from "lucide-react";
import { springSoft } from "@/lib/motion";
import { statusColor, type DashboardIntel } from "@/lib/insights";

/**
 * Insight du jour — une seule phrase, régénérée selon l'heure, la progression
 * et les signaux croisés. Suivie des recommandations inter-modules.
 */
function DailyInsightBase({ intel }: { intel: DashboardIntel }) {
  const color = statusColor[intel.headlineStatus];

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
      className="glass-card rounded-2xl p-5 mb-4"
      aria-label="Insight du jour"
    >
      <div className="flex items-start gap-3">
        <div
          className="size-9 rounded-xl grid place-items-center shrink-0"
          style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
        >
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Insight du jour</div>
          <p className="font-display text-[17px] md:text-lg font-semibold leading-snug mt-1">{intel.headline}</p>

          {intel.crossInsights.length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {intel.crossInsights.map((c) => (
                <li key={c.text} className="flex items-start gap-2 text-[13px] text-muted-foreground leading-snug">
                  <span
                    className="mt-1.5 size-1.5 rounded-full shrink-0"
                    style={{ background: statusColor[c.status] }}
                  />
                  {c.text}
                </li>
              ))}
            </ul>
          )}

        </div>
      </div>
    </motion.section>
  );
}

export const DailyInsight = memo(DailyInsightBase);
