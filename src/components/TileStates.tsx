import { motion } from "framer-motion";
import { ReactNode } from "react";
import { springSoft } from "@/lib/motion";

/** Uniform loading skeleton for a tile — glass surface, subtle pulse on opacity only. */
export function TileSkeleton({ label }: { label?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={springSoft}
      className="glass-card p-5 will-change-transform"
      aria-busy="true"
      aria-live="polite"
    >
      {label && (
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </div>
      )}
      <motion.div
        animate={{ opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        className="mt-3 h-8 w-24 rounded-lg bg-muted"
      />
      <motion.div
        animate={{ opacity: [0.25, 0.55, 0.25] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
        className="mt-2 h-3 w-16 rounded bg-muted"
      />
    </motion.div>
  );
}

/** Uniform empty-state for a tile — same glass container, same spring reveal. */
export function TileEmpty({
  label,
  message,
  icon,
  action,
}: {
  label?: string;
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
      className="glass-card p-5 will-change-transform flex flex-col items-start gap-2"
    >
      {label && (
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </div>
      )}
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm">{message}</span>
      </div>
      {action}
    </motion.div>
  );
}
