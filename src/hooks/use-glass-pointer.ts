import { useEffect } from "react";
import { readGlassQuality } from "@/hooks/use-glass-quality";

/**
 * Dynamic specular reflections + FPS watchdog for the Liquid Glass system.
 *
 * - un seul listener pointer passif, throttlé en rAF, qui écrit
 *   `--glass-sheen-x/y` sur <html> (aucun state React, aucun re-render) ;
 * - pause automatique dès que le pointeur s'immobilise (~200 ms) ou que
 *   l'onglet passe en arrière-plan ;
 * - désactivation totale si `prefers-reduced-motion`, pointeur grossier
 *   (tactile) ou qualité glass « basse » ;
 * - surveillance continue du framerate pendant les interactions : deux
 *   fenêtres consécutives sous ~48 FPS déclenchent `glass:framedrop`, que
 *   use-glass-quality traduit en rétrogradation d'un cran.
 */
export function useGlassPointer() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(hover: none)");
    const root = document.documentElement;

    let frame = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let x = 50;
    let y = 0;
    let active = false;

    // --- FPS watchdog -----------------------------------------------------
    let samples = 0;
    let slow = 0;
    let lastTs = 0;
    let slowWindows = 0;
    let degraded = false;

    const sampleFps = (ts: number) => {
      if (lastTs) {
        const dt = ts - lastTs;
        samples++;
        if (dt > 20) slow++; // < ~50 FPS
        if (samples >= 45) {
          if (slow / samples > 0.4) {
            slowWindows++;
            if (slowWindows >= 2 && !degraded && readGlassQuality() !== "low") {
              degraded = true;
              window.dispatchEvent(new Event("glass:framedrop"));
            }
          } else {
            slowWindows = 0;
          }
          samples = 0;
          slow = 0;
        }
      }
      lastTs = ts;
    };

    const flush = (ts: number) => {
      frame = 0;
      sampleFps(ts);
      root.style.setProperty("--glass-sheen-x", `${x.toFixed(1)}%`);
      root.style.setProperty("--glass-sheen-y", `${y.toFixed(1)}%`);
    };

    const goIdle = () => {
      active = false;
      lastTs = 0;
      root.removeAttribute("data-glass-active");
    };

    const onMove = (e: PointerEvent) => {
      x = (e.clientX / window.innerWidth) * 100;
      y = (e.clientY / window.innerHeight) * 100;
      if (!active) {
        active = true;
        root.setAttribute("data-glass-active", "");
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(goIdle, 200);
      if (frame) return; // throttle : au plus une écriture par frame
      frame = requestAnimationFrame(flush);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        goIdle();
      }
    };

    const enabled = () =>
      !reduced.matches && !coarse.matches && readGlassQuality() !== "low";

    let attached = false;
    const attach = () => {
      if (attached || !enabled()) return;
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      attached = true;
    };
    const detach = () => {
      if (!attached) return;
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      attached = false;
      goIdle();
    };

    const sync = () => (enabled() ? attach() : detach());
    sync();

    reduced.addEventListener("change", sync);
    coarse.addEventListener("change", sync);
    window.addEventListener("glass:framedrop", sync);
    window.addEventListener("storage", sync);

    return () => {
      detach();
      if (frame) cancelAnimationFrame(frame);
      if (idleTimer) clearTimeout(idleTimer);
      reduced.removeEventListener("change", sync);
      coarse.removeEventListener("change", sync);
      window.removeEventListener("glass:framedrop", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
}
