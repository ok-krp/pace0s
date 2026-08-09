import { useCallback, useEffect, useMemo } from "react";
import { useLocalState } from "@/lib/storage";

/**
 * Qualité Glass — pilote la lourdeur du matériau (blur, reflets spéculaires,
 * lumière de Fresnel) sans jamais toucher à la hiérarchie ni au layout.
 *
 * Les niveaux sont appliqués via `data-glass` sur <html> : tout est résolu en
 * CSS (voir styles.css), donc changer de niveau ne provoque aucun re-render.
 *
 * `auto` = niveau choisi + garde-fou FPS : si le rendu descend durablement
 * sous ~48 FPS pendant une interaction, on rétrograde d'un cran.
 */
export type GlassQuality = "high" | "balanced" | "low";

export const GLASS_QUALITY_KEY = "pace.glassQuality";
export const GLASS_AUTO_KEY = "pace.glassAuto";

export const GLASS_LEVELS: { id: GlassQuality; label: string; desc: string }[] = [
  { id: "high", label: "Haute", desc: "Flou complet, reflets dynamiques, Fresnel marqué" },
  { id: "balanced", label: "Équilibrée", desc: "Flou réduit, reflets atténués — 120 FPS confortable" },
  { id: "low", label: "Basse", desc: "Sans flou ni reflets, translucidité conservée" },
];

export function applyGlassQuality(q: GlassQuality) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-glass", q);
}

export function readGlassQuality(): GlassQuality {
  if (typeof window === "undefined") return "high";
  try {
    const raw = window.localStorage.getItem(GLASS_QUALITY_KEY);
    if (!raw) return "high";
    const v = JSON.parse(raw) as GlassQuality;
    return v === "high" || v === "balanced" || v === "low" ? v : "high";
  } catch {
    return "high";
  }
}

const LOWER: Record<GlassQuality, GlassQuality> = {
  high: "balanced",
  balanced: "low",
  low: "low",
};

export function useGlassQuality() {
  const [quality, setQuality] = useLocalState<GlassQuality>(GLASS_QUALITY_KEY, "high");
  const [auto, setAuto] = useLocalState<boolean>(GLASS_AUTO_KEY, true);

  useEffect(() => {
    applyGlassQuality(quality);
  }, [quality]);

  // Garde-fou : le moniteur FPS (use-glass-pointer) émet `glass:framedrop`
  // lorsqu'une interaction reste durablement sous la cible.
  useEffect(() => {
    if (!auto) return;
    const onDrop = () => setQuality((q) => LOWER[q]);
    window.addEventListener("glass:framedrop", onDrop);
    return () => window.removeEventListener("glass:framedrop", onDrop);
  }, [auto, setQuality]);

  const levels = useMemo(() => GLASS_LEVELS, []);
  const set = useCallback((q: GlassQuality) => setQuality(q), [setQuality]);

  return { quality, set, auto, setAuto, levels };
}
