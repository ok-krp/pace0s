import { Checkbox } from "@/components/ui/checkbox";
import { NUT_COLS, useNutritionCols, type NutCol } from "@/hooks/use-nutrition-cols";

export function NutritionColsSettings() {
  const [cols, setCols] = useNutritionCols();
  const toggle = (k: NutCol) => {
    setCols((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };
  return (
    <div className="rounded-2xl bg-card border border-border p-5 shadow-[var(--shadow-soft)]">
      <div className="font-display text-lg font-semibold mb-1">Nutrition — colonnes affichées</div>
      <div className="text-xs text-muted-foreground mb-4">Choisissez les nutriments à suivre dans l'onglet Nutrition.</div>
      <div className="grid grid-cols-2 gap-2">
        {NUT_COLS.map((c) => {
          const checked = cols.includes(c.key);
          return (
            <label key={c.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer">
              <Checkbox checked={checked} onCheckedChange={() => toggle(c.key)} />
              <span className="flex-1 truncate">{c.label}</span>
              <span className="text-xs text-muted-foreground">{c.unit}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
