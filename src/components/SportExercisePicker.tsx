import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Exercise = { id: string; name: string; muscle: string; equipment?: string };
type Props = { exercises: Exercise[]; value?: string; placeholder?: string; onChange: (id: string) => void };

export function SportExercisePicker({ exercises, value, placeholder = "+ Ajouter un exercice", onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = exercises.find((exercise) => exercise.id === value);
  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr-FR");
    const filtered = exercises.filter((exercise) => !normalized || `${exercise.name} ${exercise.muscle} ${exercise.equipment ?? ""}`.toLocaleLowerCase("fr-FR").includes(normalized));
    const grouped = new Map<string, Exercise[]>();
    for (const exercise of filtered.sort((a, b) => a.name.localeCompare(b.name, "fr-FR", { sensitivity: "base" }))) {
      const list = grouped.get(exercise.muscle) ?? [];
      list.push(exercise);
      grouped.set(exercise.muscle, list);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, "fr-FR", { sensitivity: "base" }));
  }, [exercises, query]);

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-[rgb(var(--glass-tint)/0.08)] px-3 text-left text-sm shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-xl hover:bg-[rgb(var(--glass-tint)/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <span className={selected ? "truncate" : "truncate text-muted-foreground"}>{selected?.name ?? placeholder}</span>
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        avoidCollisions
        sticky="always"
        className="!z-[9999] w-[min(28rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 p-0 shadow-2xl backdrop-blur-2xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="w-full overflow-hidden rounded-2xl">
          <Command shouldFilter={false} className="h-auto max-h-[70vh] bg-popover">
            <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder="Rechercher un exercice…" className="h-12" />
            <CommandList className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain">
              <CommandEmpty>Aucun exercice trouvé.</CommandEmpty>
              {groups.map(([muscle, list]) => (
                <CommandGroup key={muscle} heading={muscle}>
                  {list.map((exercise) => (
                    <CommandItem key={exercise.id} value={exercise.id} onSelect={() => { onChange(exercise.id); setOpen(false); setQuery(""); }} className="cursor-pointer rounded-lg">
                      <span className="min-w-0 flex-1"><span className="block truncate">{exercise.name}</span>{exercise.equipment && <span className="block truncate text-[11px] text-muted-foreground">{muscle} · {exercise.equipment}</span>}</span>
                      {exercise.id === value && <Check className="size-4 shrink-0 text-primary" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </div>
      </PopoverContent>
    </Popover>
  );
}
