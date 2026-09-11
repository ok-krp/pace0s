import type { CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";

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

/**
 * The Sport page reads programs from the local store, while production also
 * persists them in the canonical Supabase sport_programs tables. Hydrate the
 * local dashboard cache from that canonical source so a fresh dashboard does
 * not incorrectly show “Aucune séance” before the Sport page is opened.
 */
if (typeof window !== "undefined") {
  void (async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const todayDow = new Date().getDay();
      const { data, error } = await (supabase as any)
        .from("sport_programs")
        .select("id,name,days,is_archived,sport_program_items(id)")
        .eq("is_archived", false);
      if (error || !Array.isArray(data)) return;

      let local: unknown[] = [];
      try {
        const parsed = JSON.parse(localStorage.getItem("pace.sport.programs") ?? "[]");
        if (Array.isArray(parsed)) local = parsed;
      } catch {}

      const byId = new Map<string, any>();
      for (const item of local) {
        if (item && typeof item === "object" && typeof (item as any).id === "string") byId.set((item as any).id, item);
      }
      for (const row of data) {
        if (!row || typeof row.id !== "string") continue;
        const existing = byId.get(row.id) ?? {};
        byId.set(row.id, {
          ...existing,
          id: row.id,
          name: row.name,
          days: Array.isArray(row.days) ? row.days : [],
          isArchived: Boolean(row.is_archived),
          items: Array.isArray(row.sport_program_items)
            ? row.sport_program_items.map((item: { id: string }) => item)
            : (Array.isArray(existing.items) ? existing.items : []),
        });
      }

      const merged = [...byId.values()];
      const hasToday = merged.some((program) => !program.isArchived && Array.isArray(program.days) && program.days.includes(todayDow));
      if (!hasToday) return;

      localStorage.setItem("pace.sport.programs", JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent("pace.remote.write", {
        detail: { key: "pace.sport.programs", value: merged },
      }));
    } catch {}
  })();
}
