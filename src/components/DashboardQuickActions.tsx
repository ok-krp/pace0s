import { useState } from "react";
import { Dumbbell, Flame, Briefcase, CheckSquare } from "lucide-react";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocalState, todayKey } from "@/lib/storage";
import { toast } from "sonner";

type Exercise = { id: string; name: string; muscle: string };
type SessionSet = { reps: number; weight: number; done: boolean };
type SessionExercise = { exerciseId: string; sets: SessionSet[]; note?: string };
type WorkoutSession = { id: string; date: string; name: string; startedAt: number; endedAt?: number; durationMin?: number; exercises: SessionExercise[]; notes?: string };
type Habit = { id: string; name: string; emoji: string };

export function DashboardQuickRoutine({ onDone }: { onDone: () => void }) {
  const [habits] = useLocalState<Habit[]>("pace.routine.list", []);
  const [done, setDone] = useLocalState<Record<string, string[]>>("pace.routine.done", {});
  const today = todayKey();
  const todayDone = done[today] ?? [];
  const [selected, setSelected] = useState(todayDone[0] ?? "");
  const toggle = (id: string) => setDone((p) => ({ ...p, [today]: (p[today] ?? []).includes(id) ? (p[today] ?? []).filter((x) => x !== id) : [...(p[today] ?? []), id] }));
  return <><DialogHeader><DialogTitle className="font-display flex items-center gap-2"><CheckSquare className="size-5 text-primary" /> Habitude</DialogTitle><DialogDescription>Marque une habitude comme terminée aujourd'hui.</DialogDescription></DialogHeader><Select value={selected} onValueChange={setSelected}><SelectTrigger><SelectValue placeholder="Choisir une habitude" /></SelectTrigger><SelectContent>{habits.map((h) => <SelectItem key={h.id} value={h.id}>{h.emoji} {h.name}</SelectItem>)}</SelectContent></Select><Button className="rounded-xl" disabled={!selected} onClick={() => { toggle(selected); toast.success("Habitude mise à jour"); onDone(); }}>{selected && todayDone.includes(selected) ? "Marquée comme non faite" : "Marquer comme faite"}</Button></>;
}

export function DashboardQuickWork({ onDone }: { onDone: () => void }) {
  const [data, setData] = useLocalState<Record<string, number>>("pace.work.minutes", {});
  const [sessions, setSessions] = useLocalState<Array<{ id: string; date: string; cat: string; minutes: number }>>("pace.work.sessions", []);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [cat, setCat] = useState("Business");
  const today = todayKey();
  const save = () => {
    if (minutes === null || minutes <= 0) { toast.error("Renseigne une durée"); return; }
    setData((p) => ({ ...p, [today]: (p[today] ?? 0) + minutes }));
    setSessions((p) => [{ id: crypto.randomUUID(), date: today, cat, minutes }, ...p].slice(0, 100));
    toast.success(`${minutes} min ajoutées`); onDone();
  };
  return <><DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Briefcase className="size-5 text-primary" /> Focus / travail</DialogTitle><DialogDescription>Ajoute directement une session sans quitter le Dashboard.</DialogDescription></DialogHeader><div className="space-y-3"><div><label className="text-xs text-muted-foreground">Durée (minutes)</label><Input type="number" min="1" value={minutes ?? ""} onChange={(e) => setMinutes(e.target.value === "" ? null : Number(e.target.value))} placeholder="ex: 60" /></div><div><label className="text-xs text-muted-foreground">Catégorie</label><Select value={cat} onValueChange={setCat}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["École", "Business", "Sport", "Projets"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></div></div><Button className="rounded-xl" onClick={save}>Enregistrer</Button></>;
}

export function DashboardQuickWorkout({ onDone }: { onDone: () => void }) {
  const [exs] = useLocalState<Exercise[]>("pace.sport.exercises", []);
  const [sessions, setSessions] = useLocalState<WorkoutSession[]>("pace.sport.sessions", []);
  const [name, setName] = useState("Séance libre");
  const [exerciseId, setExerciseId] = useState("");
  const [sets, setSets] = useState<number | null>(null);
  const [reps, setReps] = useState<number | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const today = todayKey();
  const save = () => {
    if (!exerciseId) { toast.error("Choisis un exercice"); return; }
    const setCount = Math.max(1, sets ?? 1);
    const repCount = Math.max(0, reps ?? 0);
    const w = weight ?? 0;
    const session: WorkoutSession = { id: crypto.randomUUID(), date: today, name: name.trim() || "Séance libre", startedAt: Date.now(), endedAt: Date.now(), durationMin: duration ?? undefined, exercises: [{ exerciseId, sets: Array.from({ length: setCount }, () => ({ reps: repCount, weight: w, done: true })) }] };
    setSessions((p) => [session, ...p]);
    toast.success("Séance enregistrée"); onDone();
  };
  return <><DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Dumbbell className="size-5 text-primary" /> Séance de sport</DialogTitle><DialogDescription>Ajoute une séance et ses principales données depuis le Dashboard.</DialogDescription></DialogHeader><div className="space-y-3"><div><label className="text-xs text-muted-foreground">Nom de la séance</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div><div><label className="text-xs text-muted-foreground">Exercice</label><Select value={exerciseId} onValueChange={setExerciseId}><SelectTrigger><SelectValue placeholder="Choisir un exercice" /></SelectTrigger><SelectContent>{exs.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} — {x.muscle}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-muted-foreground">Séries</label><Input type="number" min="1" value={sets ?? ""} onChange={(e) => setSets(e.target.value === "" ? null : Number(e.target.value))} placeholder="ex: 4" /></div><div><label className="text-xs text-muted-foreground">Répétitions</label><Input type="number" min="0" value={reps ?? ""} onChange={(e) => setReps(e.target.value === "" ? null : Number(e.target.value))} placeholder="ex: 10" /></div><div><label className="text-xs text-muted-foreground">Charge (kg)</label><Input type="number" min="0" step="0.1" value={weight ?? ""} onChange={(e) => setWeight(e.target.value === "" ? null : Number(e.target.value))} placeholder="ex: 20" /></div><div><label className="text-xs text-muted-foreground">Durée (min)</label><Input type="number" min="0" value={duration ?? ""} onChange={(e) => setDuration(e.target.value === "" ? null : Number(e.target.value))} placeholder="ex: 60" /></div></div></div><Button className="rounded-xl" onClick={save}>Enregistrer la séance</Button></>;
}
