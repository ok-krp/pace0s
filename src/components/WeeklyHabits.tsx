import { memo, useMemo } from "react";

/**
 * « Habitudes de la semaine » — graphique linéaire léger (SVG pur, zéro lib,
 * zéro animation) : un point par jour (LUN → DIM) coloré selon le % de
 * réussite des habitudes du jour.
 */

const LABELS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];

export function habitColor(pct: number): string {
  if (pct < 20) return "oklch(0.62 0.21 25)"; // rouge
  if (pct < 40) return "oklch(0.72 0.17 55)"; // orange
  if (pct < 60) return "oklch(0.82 0.16 95)"; // jaune
  if (pct < 80) return "oklch(0.72 0.16 150)"; // vert
  return "oklch(0.55 0.15 160)"; // vert foncé
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Les 7 jours de la semaine courante, du lundi au dimanche. */
function weekDays(): string[] {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0 = lundi
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return iso(d);
  });
}

function WeeklyHabitsBase({
  routines,
  total,
}: {
  routines: Record<string, string[]>;
  total: number;
}) {
  const points = useMemo(() => {
    const days = weekDays();
    const denom = total || 1;
    return days.map((d, i) => {
      const pct = Math.min(100, Math.round(((routines[d]?.length ?? 0) / denom) * 100));
      return { day: LABELS[i], pct, date: d };
    });
  }, [routines, total]);

  const W = 700;
  const H = 180;
  const padX = 26;
  const padY = 16;
  const step = (W - padX * 2) / 6;
  const x = (i: number) => padX + i * step;
  const y = (p: number) => padY + (1 - p / 100) * (H - padY * 2);

  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");

  return (
    <div className="rounded-2xl glass-card p-5 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Habitudes de la semaine</div>
        <div className="text-[11px] text-muted-foreground">% d'habitudes complétées</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full h-[200px]" role="img" aria-label="Habitudes de la semaine en pourcentage">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={padX}
              x2={W - padX}
              y1={y(g)}
              y2={y(g)}
              stroke="currentColor"
              className="text-muted-foreground"
              strokeOpacity={0.14}
              strokeWidth={1}
            />
            <text x={2} y={y(g) + 3} fontSize={9} fill="currentColor" className="text-muted-foreground" opacity={0.7}>
              {g}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke="currentColor" className="text-foreground" strokeOpacity={0.45} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(i)} cy={y(p.pct)} r={5} fill={habitColor(p.pct)} />
            <text x={x(i)} y={H + 12} textAnchor="middle" fontSize={10} fill="currentColor" className="text-muted-foreground">
              {p.day}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export const WeeklyHabits = memo(WeeklyHabitsBase);
