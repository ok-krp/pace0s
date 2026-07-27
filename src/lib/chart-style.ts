import type { CSSProperties } from "react";

/**
 * Liquid Glass tooltip style shared across all Recharts <Tooltip /> callers.
 * Mirrors the .glass-card material (blur, Fresnel rim, squircle radius).
 */
export const liquidTooltipStyle: CSSProperties = {
  background:
    "linear-gradient(180deg, rgb(var(--glass-tint) / calc(var(--glass-tint-strength) + 0.16)) 0%, rgb(var(--glass-tint) / calc(var(--glass-tint-strength) + 0.06)) 100%)",
  backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
  border: "1px solid color-mix(in oklab, white calc(var(--glass-edge) * 55%), transparent)",
  borderRadius: 20,
  boxShadow:
    "inset 0 1px 0 0 color-mix(in oklab, white calc(var(--glass-edge) * 70%), transparent), var(--glass-elev-2)",
  fontSize: 12,
  color: "var(--foreground)",
  padding: "8px 12px",
};

export const liquidTooltipCursor = {
  fill: "color-mix(in oklab, var(--foreground) 5%, transparent)",
  radius: 8,
};

/** Shared line/area rendering defaults — thinner strokes, crisper AA. */
export const liquidLineProps = {
  strokeWidth: 1.75,
  dot: false as const,
  activeDot: { r: 3.5, strokeWidth: 0 },
  isAnimationActive: false as const,
};
