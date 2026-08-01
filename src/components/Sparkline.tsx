import { memo, useMemo } from "react";

/**
 * Micro-visualisation : sparkline SVG statique (aucune lib, aucun re-render).
 * Utilisée dans chaque carte du dashboard pour donner la tendance 7 jours.
 */
function SparklineBase({
  data,
  color = "var(--primary)",
  width = 96,
  height = 26,
  area = true,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  area?: boolean;
}) {
  const { line, fill, last } = useMemo(() => {
    const pts = data.length > 1 ? data : [0, 0];
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const step = width / (pts.length - 1);
    const xy = pts.map((v, i) => {
      const x = i * step;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return [x, y] as const;
    });
    const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return {
      line: d,
      fill: `${d} L${width},${height} L0,${height} Z`,
      last: xy[xy.length - 1],
    };
  }, [data, width, height]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      {area && <path d={fill} fill={color} opacity={0.12} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

export const Sparkline = memo(SparklineBase);
