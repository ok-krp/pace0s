import { memo } from "react";
import { Trash2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { scaleItem, sumItems, type FoodItem } from "@/lib/nutrition-ai.shared";

function confidenceTone(c: number) {
  if (c >= 0.75) return { label: "Confiance élevée", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" };
  if (c >= 0.5) return { label: "Confiance moyenne", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" };
  return { label: "Confiance faible", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" };
}

/**
 * Correction rapide d'une analyse photo : chaque aliment détecté est éditable
 * (nom + grammes), les macros se recalculent proportionnellement.
 */
function FoodAnalysisEditorBase({
  items,
  onChange,
  confidence,
  confidenceNote,
  compact = false,
}: {
  items: FoodItem[];
  onChange: (items: FoodItem[]) => void;
  confidence: number;
  confidenceNote?: string;
  compact?: boolean;
}) {
  const totals = sumItems(items);
  const tone = confidenceTone(confidence);

  const update = (i: number, next: FoodItem) => onChange(items.map((it, k) => (k === i ? next : it)));
  const remove = (i: number) => onChange(items.filter((_, k) => k !== i));

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary font-medium">
          <Sparkles className="size-3.5" />
          Aliments détectés
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${tone.cls}`}>
          {tone.label} · {Math.round(confidence * 100)}%
        </span>
      </div>

      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={`${it.name}-${i}`} className="flex items-center gap-2 rounded-xl bg-muted/30 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <Input
                value={it.name}
                onChange={(e) => update(i, { ...it, name: e.target.value })}
                className="h-7 border-0 bg-transparent px-0 text-[13px] font-medium shadow-none focus-visible:ring-0"
              />
              <div className="text-[10px] text-muted-foreground truncate">
                {it.brand ? `${it.brand} · ` : ""}
                {it.kcal} kcal · P {it.protein_g} · G {it.carbs_g} · L {it.fat_g}
              </div>
            </div>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={it.grams}
              onChange={(e) => update(i, scaleItem(it, Math.max(0, Number(e.target.value) || 0)))}
              className="h-8 w-20 rounded-lg text-right"
              aria-label={`Quantité ${it.name}`}
            />
            <span className="text-[10px] text-muted-foreground">g</span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-muted-foreground hover:text-rose-500 transition"
              aria-label={`Retirer ${it.name}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-4 gap-px bg-border rounded-xl overflow-hidden">
        {[
          ["kcal", totals.kcal],
          ["P", `${totals.protein_g}g`],
          ["G", `${totals.carbs_g}g`],
          ["L", `${totals.fat_g}g`],
        ].map(([k, v]) => (
          <div key={String(k)} className="bg-card px-2 py-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</div>
            <div className="text-sm font-semibold">{v}</div>
          </div>
        ))}
      </div>

      {!compact && (
        <div className="grid grid-cols-3 gap-px bg-border rounded-xl overflow-hidden">
          {[
            ["Fibres", `${totals.fiber_g}g`],
            ["Sucres", `${totals.sugar_g}g`],
            ["Sodium", `${Math.round(totals.sodium_mg)}mg`],
          ].map(([k, v]) => (
            <div key={String(k)} className="bg-card px-2 py-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</div>
              <div className="text-sm font-semibold">{v}</div>
            </div>
          ))}
        </div>
      )}

      {confidenceNote && <p className="text-[11px] text-muted-foreground leading-snug">{confidenceNote}</p>}
    </div>
  );
}

export const FoodAnalysisEditor = memo(FoodAnalysisEditorBase);
