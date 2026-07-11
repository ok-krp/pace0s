/**
 * Shared framer-motion presets for Pace.
 * Only opacity + transform are animated → GPU-composited, 120fps-ready.
 */
import type { Transition } from "framer-motion";

export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 26,
  mass: 0.6,
};

export const springSnap: Transition = {
  type: "spring",
  stiffness: 480,
  damping: 30,
  mass: 0.5,
};

export const interactiveMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  whileHover: { y: -1, scale: 1.015 },
  whileTap: { scale: 0.97 },
  whileFocus: { scale: 1.01 },
  transition: springSoft,
};

/** Base focus / active ring shared across interactive glass surfaces. */
export const interactiveRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0";
