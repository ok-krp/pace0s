import { useEffect } from "react";

/**
 * Dynamic specular reflections for the Liquid Glass system.
 *
 * A single document-level pointer listener, rAF-throttled, writes
 * `--glass-sheen-x` / `--glass-sheen-y` on <html>. Every glass surface reads
 * those variables in CSS only — no per-component listeners, no React state,
 * no re-renders. Idles automatically when the pointer stops moving.
 */
export function useGlassPointer() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Coarse pointers (touch) have no hover highlight to track.
    if (window.matchMedia("(hover: none)").matches) return;

    const root = document.documentElement;
    let frame = 0;
    let x = 50;
    let y = 0;

    const flush = () => {
      frame = 0;
      root.style.setProperty("--glass-sheen-x", `${x.toFixed(1)}%`);
      root.style.setProperty("--glass-sheen-y", `${y.toFixed(1)}%`);
    };

    const onMove = (e: PointerEvent) => {
      x = (e.clientX / window.innerWidth) * 100;
      y = (e.clientY / window.innerHeight) * 100;
      if (frame) return; // throttle: at most one write per frame
      frame = requestAnimationFrame(flush);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
