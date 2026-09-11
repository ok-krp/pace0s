import { useLocalState } from "@/lib/storage";
import { Switch } from "@/components/ui/switch";

export type DailyPriority = "off" | "low" | "normal" | "high";
export type DailyPriorityKey = "sleep" | "water" | "nutrition" | "sport" | "routine" | "focus" | "weight";

export const DAILY_PRIORITY_DEFAULTS: Record<DailyPriorityKey, DailyPriority> = {
  sleep: "high",
  water: "normal",
  nutrition: "high",
  sport: "normal",
  routine: "normal",
  focus: "normal",
  weight: "low",
};

const ITEMS: Array<{ key: DailyPriorityKey; label: string; description: string }> = [
  { key: "sleep", label: "Sommeil", description: "Suivi et objectif de sommeil" },
  { key: "water", label: "Hydratation", description: "Objectif d'eau quotidien" },
  { key: "nutrition", label: "Nutrition", description: "Calories et repas" },
  { key: "sport", label: "Sport", description: "Entraînement et activité" },
  { key: "routine", label: "Routine", description: "Habitudes quotidiennes" },
  { key: "focus", label: "Focus", description: "Temps de travail concentré" },
  { key: "weight", label: "Poids", description: "Suivi du poids" },
];

const LEVELS: DailyPriority[] = ["off", "low", "normal", "high"];
const LABELS: Record<DailyPriority, string> = { off: "Désactivé", low: "Faible", normal: "Normal", high: "Important" };

export function useDailyPriorities() {
  const [priorities, setPriorities] = useLocalState<Record<DailyPriorityKey, DailyPriority>>("pace.daily.priorities", DAILY_PRIORITY_DEFAULTS);
  const setPriority = (key: DailyPriorityKey, priority: DailyPriority) => setPriorities((prev) => ({ ...DAILY_PRIORITY_DEFAULTS, ...prev, [key]: priority }));
  return { priorities, setPriority };
}

export function DailyPrioritySettings() {
  const { priorities, setPriority } = useDailyPriorities();

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">Choisissez ce qui compte dans votre journée. Un élément désactivé n'est plus considéré comme une priorité quotidienne.</div>
      {ITEMS.map((item) => {
        const value = priorities[item.key] ?? DAILY_PRIORITY_DEFAULTS[item.key];
        const enabled = value !== "off";
        return (
          <div key={item.key} className="flex items-center gap-3 glass-card p-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-xs text-muted-foreground">{item.description}</div>
            </div>
            <Switch checked={enabled} onCheckedChange={(checked) => setPriority(item.key, checked ? (value === "off" ? "normal" : value) : "off")} />
            <select
              aria-label={`Importance de ${item.label}`}
              value={value}
              disabled={!enabled}
              onChange={(event) => setPriority(item.key, event.target.value as DailyPriority)}
              className="h-9 min-w-28 rounded-lg border border-border bg-background/30 px-2 text-xs font-medium disabled:opacity-50"
            >
              {LEVELS.map((level) => <option key={level} value={level}>{LABELS[level]}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}
