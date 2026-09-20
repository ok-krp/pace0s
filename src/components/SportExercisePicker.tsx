import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Exercise = { id: string; name: string; muscle: string; equipment?: string };

type Props = {
  exercises: Exercise[];
  value?: string;
  placeholder?: string;
  onChange: (id: string) => void;
};

export function SportExercisePicker({ exercises, value, placeholder = "+ Ajouter un exercice", onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = exercises.find((exercise) => exercise.id === value);
  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr-FR");
    const filtered = exercises
      .filter((exercise) => {
        if (!normalized) return true;
        return `${exercise.name} ${exercise.muscle} ${exercise.equipment ?? ""}`.toLocaleLowerCase("fr-FR").includes(normalized);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "fr-FR", { sensitivity: "base" }));
    const grouped = new Map<string, Exercise[]>();
    for (const exercise of filtered) {
      const list = grouped.get(exercise.muscle) ?? [];
      list.push(exercise);
      grouped.set(exercise.muscle, list);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, "fr-FR", { sensitivity: "base" }));
  }, [exercises, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((current) => !current); setQuery(""); }}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-[rgb(var(--glass-tint)/0.08)] px-3 text-left text-sm shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-xl transition-colors hover:bg-[rgb(var(--glass-tint)/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={selected ? "truncate" : "truncate text-muted-foreground"}>{selected?.name ?? placeholder}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border/70 bg-[rgb(var(--glass-tint)/0.96)] p-2 shadow-[var(--glass-elev-3)] backdrop-blur-2xl">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un exercice…" className="h-9 pl-9" />
          </div>
          <div className="max-h-64 overflow-y-auto pr-0.5" role="listbox">
            {groups.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">Aucun exercice trouvé.</div>
            ) : groups.map(([muscle, list]) => (
              <div key={muscle} className="mb-2 last:mb-0">
                <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{muscle}</div>
                {list.map((exercise) => (
                  <button
                    type="button"
                    key={exercise.id}
                    role="option"
                    aria-selected={exercise.id === value}
                    onClick={() => { onChange(exercise.id); setOpen(false); setQuery(""); }}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-[rgb(var(--glass-tint)/0.12)] aria-selected:bg-primary/10"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{exercise.name}</span>
                      {exercise.equipment && <span className="block truncate text-[11px] text-muted-foreground">{muscle} · {exercise.equipment}</span>}
                    </span>
                    {exercise.id === value && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
