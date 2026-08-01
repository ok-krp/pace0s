import { memo, useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";

/**
 * Compteur animé — écrit directement dans le DOM (aucun state, aucun re-render).
 * Respecte « Réduire les animations ».
 */
function AnimatedNumberBase({
  value,
  digits = 0,
  className,
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotion();
  const prev = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || !inView) {
      el.textContent = value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
      prev.current = value;
      return;
    }
    const from = prev.current;
    prev.current = value;
    const controls = animate(from, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        el.textContent = v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
      },
    });
    return () => controls.stop();
  }, [value, digits, reduce, inView]);

  return <span ref={ref} className={className}>0</span>;
}

export const AnimatedNumber = memo(AnimatedNumberBase);
