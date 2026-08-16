import { useMemo, useState } from "react";
import { Check, Dumbbell, Play, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type FreeWorkoutExercise = { name: string; sets: number; reps: number; weight: number };

const DEFAULT_EXERCISES = [
  "Développé couché", "Développé incliné haltères", "Pompes", "Écarté haltères",
  "Tractions", "Rowing haltères", "Tirage horizontal", "Tirage vertical",
  "Développé militaire", "Élévations latérales", "Oiseau haltères", "Curl biceps",
  "Curl marteau", "Extension triceps", "Dips", "Squat", "Fentes",
  "Soulevé de terre roumain", "Hip thrust", "Mollets debout"
];

export function FreeWorkoutPicker({ exercises = DEFAULT_EXERCISES, onStart, onCancel }: { exercises?: string[]; onStart: (exercises: FreeWorkoutExercise[]) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FreeWorkoutExercise[]>([]);
  const filtered = useMemo(() => exercises.filter(x => x.toLowerCase().includes(query.toLowerCase())), [exercises, query]);
  const toggle = (name: string) => setSelected(s => s.some(x => x.name === name) ? s.filter(x => x.name !== name) : [...s, { name, sets: 3, reps: 10, weight: 0 }]);
  const update = (name: string, key: "sets" | "reps" | "weight", value: number) => setSelected(s => s.map(x => x.name === name ? { ...x, [key]: value } : x));

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Dumbbell size={19}/> Séance libre</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" size={17}/><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un exercice…" className="pl-9" /></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(name => { const active = selected.some(x => x.name === name); return <button key={name} type="button" onClick={() => toggle(name)} className={`flex items-center justify-between rounded-xl border p-3 text-left ${active ? "border-primary bg-primary/10" : "hover:bg-muted/50"}`}><span>{name}</span>{active && <Check size={17}/>}</button>; })}</div>
      {selected.length > 0 && <div className="space-y-2"><div className="text-sm font-medium">Sélection ({selected.length})</div>{selected.map((x, i) => <div key={x.name} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 rounded-xl border p-3"><span className="truncate">{i + 1}. {x.name}</span><Input className="w-16" type="number" min="1" value={x.sets} onChange={e => update(x.name, "sets", Math.max(1, Number(e.target.value)))} aria-label="Séries"/><Input className="w-16" type="number" min="1" value={x.reps} onChange={e => update(x.name, "reps", Math.max(1, Number(e.target.value)))} aria-label="Répétitions"/><Input className="w-20" type="number" min="0" step="0.5" value={x.weight} onChange={e => update(x.name, "weight", Math.max(0, Number(e.target.value)))} aria-label="Charge"/><Button variant="ghost" size="icon" onClick={() => toggle(x.name)}><X size={16}/></Button></div>)}</div>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Annuler</Button><Button disabled={!selected.length} onClick={() => onStart(selected)} className="gap-2"><Play size={16}/> Démarrer</Button></div>
    </CardContent>
  </Card>;
}
