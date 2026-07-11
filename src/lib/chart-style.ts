import type { CSSProperties } from "react";

/**
 * Liquid Glass tooltip style shared across all Recharts <Tooltip /> callers.
 * Mirrors the .glass-card utility (blur, saturate, squircle radius, subtle border).
 */
export const liquidTooltipStyle: CSSProperties = {
  background: "color-mix(in oklab, var(--card) 65%, transparent)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  border: "1px solid color-mix(in oklab, white 25%, transparent)",
  borderRadius: 16,
  boxShadow:
    "0 1px 2px oklch(0.2 0.04 260 / 0.06), 0 12px 40px -12px oklch(0.2 0.04 260 / 0.22)",
  fontSize: 12,
  color: "var(--foreground)",
  padding: "8px 12px",
};

export const liquidTooltipCursor = {
  fill: "color-mix(in oklab, var(--foreground) 6%, transparent)",
  radius: 8,
};
