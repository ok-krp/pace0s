import type { CSSProperties } from "react";

/**
 * Liquid Glass tooltip style shared across all Recharts <Tooltip /> callers.
 * Mirrors the .glass-card material (blur, Fresnel rim, squircle radius).
 */
export const liquidTooltipStyle: CSSProperties = {
  background:
    "linear-gradient(180deg, rgb(var(--glass-tint) / calc(var(--glass-tint-strength) + 0.42)) 0%, rgb(var(--glass-tint) / calc(var(--glass-tint-strength) + 0.3)) 100%)",
  backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
  border: "none",
  borderRadius: 20,
  boxShadow:
    "inset 0 0 0 1px color-mix(in oklab, white calc(var(--glass-edge) * 45%), transparent), inset 0 1px 0 0 color-mix(in oklab, white calc(var(--glass-edge) * 70%), transparent), var(--glass-elev-2)",
  fontSize: 12,
  color: "var(--foreground)",
  padding: "8px 12px",
};

export const liquidTooltipCursor = {
  fill: "color-mix(in oklab, var(--foreground) 5%, transparent)",
  radius: 8,
};

/** Shared line/area rendering defaults — thinner strokes, crisper AA. */
/** Point de données toujours visible, même sans ligne de liaison. */
export const liquidDot = (color: string) => ({ r: 3, fill: color, stroke: "transparent", strokeWidth: 0 });

export const liquidLineProps = {
  strokeWidth: 1.75,
  dot: { r: 3, strokeWidth: 0 },
  activeDot: { r: 3.5, strokeWidth: 0 },
  isAnimationActive: false as const,
};
