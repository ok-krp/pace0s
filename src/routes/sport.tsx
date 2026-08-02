import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Dumbbell, Plus, Trash2, Play, Square, Check, Pencil, Calendar as CalIcon, History } from "lucide-react";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, todayKey, lastNDays } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrendingUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/sport")({
  head: () => ({ meta: [{ title: "Sport — Pace" }, { name: "description", content: "Exercices, programmes, séances : votre suivi sportif tout-en-un." }] }),
  component: SportPage,
});

type Exercise = {
  id: string;
  name: string;
  muscle: string;
  equipment?: string;
  notes?: string;
  defaultSets?: number;
  defaultReps?: number;
  defaultWeight?: number;
  restSec?: number;
};

type ProgramItem = { exerciseId: string; sets: number; reps: number; weight?: number; restSec?: number };
type Program = {
  id: string;
  name: string;
  emoji: string;
  days: number[]; // 0=Dim ... 6=Sam (JS getDay)
  items: ProgramItem[];
};

type SessionSet = { reps: number; weight: number; done: boolean };
type SessionExercise = { exerciseId: string; sets: SessionSet[]; note?: string };
type WorkoutSession = {
  id: string;
  date: string;
  programId?: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  durationMin?: number;
  exercises: SessionExercise[];
  notes?: string;
};

const MUSCLES = ["Pectoraux", "Dos", "Épaules", "Biceps", "Triceps", "Quadriceps", "Ischios", "Fessiers", "Mollets", "Abdos", "Cardio", "Autre"];
const DAYS_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function SportPage() {
  const [exs, setExs] = useLocalState<Exercise[]>("lt.sport.exercises", []);
  const [progs, setProgs] = useLocalState<Program[]>("lt.sport.programs", []);
  const [sessions, setSessions] = useLocalState<WorkoutSession[]>("lt.sport.sessions", []);
  const [active, setActive] = useLocalState<WorkoutSession | null>("lt.sport.active", null);
  const [tab, setTab] = useState("programs");
  const [focusEx, setFocusEx] = useState<string | null>(null);

  // Ancrage contextuel : un clic sur un exercice bascule sur Surcharge et
  // scrolle directement sur ses données.
  const openOverload = (exerciseId: string) => {
    setFocusEx(exerciseId);
    setTab("overload");
  };


  const todayDow = new Date().getDay();
  const todayPrograms = progs.filter((p) => p.days.includes(todayDow));

  const startSession = (program?: Program) => {
    const exercises: SessionExercise[] = program
      ? program.items.map((it) => ({
          exerciseId: it.exerciseId,
          sets: Array.from({ length: it.sets }, () => ({ reps: it.reps, weight: it.weight ?? 0, done: false })),
        }))
      : [];
    const s: WorkoutSession = {
      id: crypto.randomUUID(),
      date: todayKey(),
      programId: program?.id,
      name: program?.name ?? "Séance libre",
      startedAt: Date.now(),
      exercises,
    };
    setActive(s);
    toast.success("Séance démarrée");
  };

  const finishSession = () => {
    if (!active) return;
    const ended = Date.now();
    const final: WorkoutSession = { ...active, endedAt: ended, durationMin: Math.round((ended - active.startedAt) / 60000) };
    setSessions((p) => [final, ...p]);
    setActive(null);
    toast.success(`Séance terminée — ${final.durationMin} min`);
  };

  const cancelSession = () => {
    if (!confirm("Abandonner la séance en cours ?")) return;
    setActive(null);
  };

  // Stats simples
  const last7 = lastNDays(7);
  const sessionsThisWeek = sessions.filter((s) => last7.includes(s.date));
  const daysActive = new Set(sessionsThisWeek.map((s) => s.date)).size;

  return (
    <div>
      <PageHeader title="Sport" subtitle="Tes exercices, tes programmes, tes séances — à ton image." />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <StatCard
          label="Séances des 7 derniers jours"
          value={sessionsThisWeek.length}
          unit={sessionsThisWeek.length > 1 ? "séances" : "séance"}
          icon={<Dumbbell className="size-4" />}
        />
        <StatCard
          label="Jours actifs (sur 7)"
          value={`${daysActive} / 7`}
          icon={<CalIcon className="size-4" />}
        />
      </div>

      {active ? (
        <ActiveSession active={active} setActive={setActive} exs={exs} onFinish={finishSession} onCancel={cancelSession} />
      ) : (
        <div className="rounded-2xl glass-card p-4 sm:p-5 mb-3">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="font-display text-base sm:text-lg font-semibold flex items-center gap-2"><CalIcon className="size-4 text-muted-foreground" /> Aujourd'hui ({DAYS_LABELS[todayDow]})</div>
          </div>
          {todayPrograms.length === 0 ? (
            <div className="text-sm text-muted-foreground">Aucun programme prévu aujourd'hui. Crée-en un dans l'onglet Programmes.</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {todayPrograms.map((p) => (
                <div key={p.id} className="rounded-xl glass-thin p-3 flex items-center gap-3">
                  <div className="text-2xl">{p.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.items.length} exercice{p.items.length === 1 ? "" : "s"}</div>
                  </div>
                  <Button size="sm" onClick={() => startSession(p)} className="rounded-lg"><Play className="size-3 mr-1" />Démarrer</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="overflow-x-auto -mx-1 px-1 mb-2 scrollbar-hide">
          <TabsList className="inline-flex w-max min-w-full">
            <TabsTrigger value="programs" className="text-xs sm:text-sm">Programmes</TabsTrigger>
            <TabsTrigger value="exercises" className="text-xs sm:text-sm">Exercices</TabsTrigger>
            <TabsTrigger value="overload" className="text-xs sm:text-sm"><TrendingUp className="size-3 mr-1" />Surcharge</TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm"><History className="size-3 mr-1" />Historique</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="programs">
          <ProgramsTab progs={progs} setProgs={setProgs} exs={exs} onOpenExercise={openOverload} />
        </TabsContent>

        <TabsContent value="exercises">
          <ExercisesTab exs={exs} setExs={setExs} />
        </TabsContent>

        <TabsContent value="overload">
          <OverloadTab exs={exs} focusExerciseId={focusEx} />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab sessions={sessions} exs={exs} onDelete={(id) => setSessions((p) => p.filter((s) => s.id !== id))} />
        </TabsContent>
      </Tabs>

    </div>
  );
}


function ActiveSession({ active, setActive, exs, onFinish, onCancel }: {
  active: WorkoutSession;
  setActive: (v: WorkoutSession | null) => void;
  exs: Exercise[];
  onFinish: () => void;
  onCancel: () => void;
}) {
  const updateSet = (exIdx: number, setIdx: number, patch: Partial<SessionSet>) => {
    const next = { ...active, exercises: active.exercises.map((e, i) => i !== exIdx ? e : { ...e, sets: e.sets.map((s, j) => j !== setIdx ? s : { ...s, ...patch }) }) };
    setActive(next);
  };
  const addSet = (exIdx: number) => {
    const last = active.exercises[exIdx].sets.slice(-1)[0];
    const next = { ...active, exercises: active.exercises.map((e, i) => i !== exIdx ? e : { ...e, sets: [...e.sets, { reps: last?.reps ?? 8, weight: last?.weight ?? 0, done: false }] }) };
    setActive(next);
  };
  const addExercise = (id: string) => {
    setActive({ ...active, exercises: [...active.exercises, { exerciseId: id, sets: [{ reps: 8, weight: 0, done: false }] }] });
  };
  const removeExercise = (idx: number) => {
    setActive({ ...active, exercises: active.exercises.filter((_, i) => i !== idx) });
  };

  return (
    <div className="rounded-2xl glass-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-xs text-primary font-medium uppercase tracking-wider">Séance en cours</div>
          <div className="font-display text-xl font-semibold">{active.name}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Annuler</Button>
          <Button onClick={onFinish} className="rounded-xl"><Square className="size-3 mr-1" />Terminer</Button>
        </div>
      </div>

      <div className="space-y-3">
        {active.exercises.map((e, exIdx) => {
          const meta = exs.find((x) => x.id === e.exerciseId);
          return (
            <div key={exIdx} className="rounded-xl glass-thin p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{meta?.name ?? "Exercice"} <span className="text-xs text-muted-foreground">{meta?.muscle}</span></div>
                <button onClick={() => removeExercise(exIdx)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
              </div>
              <div className="space-y-1.5">
                {e.sets.map((s, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-6">{j + 1}.</span>
                    <Input type="number" value={s.weight || ""} onChange={(ev) => updateSet(exIdx, j, { weight: +ev.target.value || 0 })} placeholder="kg" className="h-8 w-20 text-sm" />
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input type="number" value={s.reps || ""} onChange={(ev) => updateSet(exIdx, j, { reps: +ev.target.value || 0 })} placeholder="reps" className="h-8 w-20 text-sm" />
                    <button onClick={() => updateSet(exIdx, j, { done: !s.done })} className={`size-7 rounded-md grid place-items-center ${s.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <Check className="size-3.5" />
                    </button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" onClick={() => addSet(exIdx)} className="h-7 text-xs"><Plus className="size-3 mr-1" />Série</Button>
              </div>
            </div>
          );
        })}

        <Select onValueChange={(v) => addExercise(v)}>
          <SelectTrigger className="rounded-xl"><SelectValue placeholder="+ Ajouter un exercice" /></SelectTrigger>
          <SelectContent>{exs.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} — {x.muscle}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ExercisesTab({ exs, setExs }: { exs: Exercise[]; setExs: (v: Exercise[] | ((p: Exercise[]) => Exercise[])) => void }) {
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [open, setOpen] = useState(false);
  const save = (e: Exercise) => {
    setExs((p) => {
      const i = p.findIndex((x) => x.id === e.id);
      if (i >= 0) { const n = [...p]; n[i] = e; return n; }
      return [...p, e];
    });
    setEditing(null); setOpen(false);
  };

  return (
    <div className="space-y-3">
      <Button onClick={() => { setEditing({ id: crypto.randomUUID(), name: "", muscle: MUSCLES[0] }); setOpen(true); }} className="rounded-xl"><Plus className="size-4 mr-1" />Nouvel exercice</Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        {editing && <ExerciseForm key={editing.id} ex={editing} onSave={save} onCancel={() => { setEditing(null); setOpen(false); }} />}
      </Dialog>

      {exs.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Aucun exercice. Crée-en un pour commencer.</div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {exs.map((e) => (
            <div key={e.id} className="rounded-xl glass-thin p-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-muted-foreground">{e.muscle}{e.equipment ? ` · ${e.equipment}` : ""}</div>
                {e.notes && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.notes}</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => { setEditing(e); setOpen(true); }} className="text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /></button>
                <button onClick={() => setExs((p) => p.filter((x) => x.id !== e.id))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExerciseForm({ ex, onSave, onCancel }: { ex: Exercise | null; onSave: (e: Exercise) => void; onCancel: () => void }) {
  const [e, setE] = useState<Exercise | null>(ex);
  if (!e) return null;
  const up = <K extends keyof Exercise>(k: K, v: Exercise[K]) => setE({ ...e, [k]: v });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{ex?.name ? "Modifier" : "Nouvel exercice"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <Input placeholder="Nom (ex: Développé couché)" value={e.name} onChange={(ev) => up("name", ev.target.value)} />
        <Select value={e.muscle} onValueChange={(v) => up("muscle", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{MUSCLES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="Matériel (haltères, barre…)" value={e.equipment ?? ""} onChange={(ev) => up("equipment", ev.target.value)} />
        <Textarea placeholder="Notes perso (technique, ressenti…)" value={e.notes ?? ""} onChange={(ev) => up("notes", ev.target.value)} rows={3} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Annuler</Button>
          <Button onClick={() => e.name && onSave(e)}>Enregistrer</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function ProgramsTab({ progs, setProgs, exs, onOpenExercise }: { progs: Program[]; setProgs: (v: Program[] | ((p: Program[]) => Program[])) => void; exs: Exercise[]; onOpenExercise: (exerciseId: string) => void }) {
  const [editing, setEditing] = useState<Program | null>(null);
  const [open, setOpen] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);

  const save = (p: Program) => {
    setProgs((prev) => {
      const i = prev.findIndex((x) => x.id === p.id);
      if (i >= 0) { const n = [...prev]; n[i] = p; return n; }
      return [...prev, p];
    });
    setEditing(null); setOpen(false);
  };

  const opened = progs.find((p) => p.id === openedId) ?? null;

  if (opened) {
    // Vue détaillée : exercices du programme regroupés par groupe musculaire.
    const groups = new Map<string, { item: ProgramItem; ex: Exercise }[]>();
    opened.items.forEach((item) => {
      const ex = exs.find((x) => x.id === item.exerciseId);
      if (!ex) return;
      const arr = groups.get(ex.muscle) ?? [];
      arr.push({ item, ex });
      groups.set(ex.muscle, arr);
    });

    return (
      <div className="space-y-3">
        <button onClick={() => setOpenedId(null)} className="text-sm text-muted-foreground hover:text-foreground">← Programmes</button>
        <div className="rounded-2xl glass-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">{opened.emoji}</span>
            <div>
              <div className="font-display text-lg font-semibold">{opened.name}</div>
              <div className="text-xs text-muted-foreground">{opened.items.length} exercice{opened.items.length === 1 ? "" : "s"} · {opened.days.map((d) => DAYS_LABELS[d]).join(" · ") || "Aucun jour"}</div>
            </div>
          </div>
        </div>

        {groups.size === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">Aucun exercice dans ce programme.</div>
        ) : (
          [...groups.entries()].map(([muscle, list]) => (
            <div key={muscle} className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">{muscle}</div>
              {list.map(({ item, ex }) => (
                <button
                  key={ex.id + item.exerciseId}
                  onClick={() => onOpenExercise(ex.id)}
                  className="w-full text-left rounded-xl glass-thin p-3 flex items-center justify-between gap-3 hover:bg-[rgb(var(--glass-tint)/0.08)]"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{ex.name}</div>
                    <div className="text-xs text-muted-foreground">{item.sets} × {item.reps}{item.weight ? ` · ${item.weight} kg` : ""}{ex.equipment ? ` · ${ex.equipment}` : ""}</div>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1"><TrendingUp className="size-3" />Surcharge →</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button onClick={() => { setEditing({ id: crypto.randomUUID(), name: "", emoji: "💪", days: [], items: [] }); setOpen(true); }} className="rounded-xl" disabled={exs.length === 0}>
        <Plus className="size-4 mr-1" />Nouveau programme
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        {editing && <ProgramForm key={editing.id} prog={editing} exs={exs} onSave={save} onCancel={() => { setEditing(null); setOpen(false); }} />}
      </Dialog>
      {exs.length === 0 && <div className="text-xs text-muted-foreground">Crée d'abord des exercices.</div>}

      {progs.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Aucun programme.</div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {progs.map((p) => (
            <div key={p.id} className="rounded-xl glass-thin p-3">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => setOpenedId(p.id)} className="flex items-center gap-2 min-w-0 text-left flex-1">
                  <div className="text-2xl">{p.emoji}</div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.days.map((d) => DAYS_LABELS[d]).join(" · ") || "Aucun jour"} · {p.items.length} ex.</div>
                  </div>
                </button>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditing(p); setOpen(true); }} className="text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /></button>
                  <button onClick={() => setProgs((prev) => prev.filter((x) => x.id !== p.id))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function ProgramForm({ prog, exs, onSave, onCancel }: { prog: Program | null; exs: Exercise[]; onSave: (p: Program) => void; onCancel: () => void }) {
  const [p, setP] = useState<Program | null>(prog);
  if (!p) return null;
  const up = <K extends keyof Program>(k: K, v: Program[K]) => setP({ ...p, [k]: v });
  const toggleDay = (d: number) => up("days", p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d]);
  const addItem = (id: string) => up("items", [...p.items, { exerciseId: id, sets: 3, reps: 10 }]);
  const updateItem = (i: number, patch: Partial<ProgramItem>) => up("items", p.items.map((it, idx) => idx !== i ? it : { ...it, ...patch }));
  const removeItem = (i: number) => up("items", p.items.filter((_, idx) => idx !== i));

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{prog?.name ? "Modifier" : "Nouveau programme"}</DialogTitle></DialogHeader>
      <div className="space-y-3 max-h-[70vh] overflow-y-auto">
        <div className="flex gap-2">
          <Input value={p.emoji} onChange={(e) => up("emoji", e.target.value)} className="w-16 text-center" maxLength={2} />
          <Input placeholder="Nom (Push, Pull, Legs…)" value={p.name} onChange={(e) => up("name", e.target.value)} className="flex-1" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Jours de la semaine</div>
          <div className="flex gap-1 flex-wrap">
            {DAYS_LABELS.map((d, i) => (
              <button key={i} onClick={() => toggleDay(i)} className={`px-3 py-1.5 rounded-lg text-xs ${p.days.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{d}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Exercices</div>
          <div className="space-y-2">
            {p.items.map((it, i) => {
              const meta = exs.find((x) => x.id === it.exerciseId);
              return (
                <div key={i} className="flex items-center gap-1.5 text-sm">
                  <span className="flex-1 truncate">{meta?.name ?? "?"}</span>
                  <Input type="number" value={it.sets} onChange={(e) => updateItem(i, { sets: +e.target.value || 1 })} className="h-8 w-14" />
                  <span className="text-xs text-muted-foreground">×</span>
                  <Input type="number" value={it.reps} onChange={(e) => updateItem(i, { reps: +e.target.value || 1 })} className="h-8 w-14" />
                  <Input type="number" placeholder="kg" value={it.weight ?? ""} onChange={(e) => updateItem(i, { weight: +e.target.value || 0 })} className="h-8 w-16" />
                  <button onClick={() => removeItem(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                </div>
              );
            })}
            <Select onValueChange={(v) => addItem(v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="+ Ajouter un exercice" /></SelectTrigger>
              <SelectContent>{exs.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Annuler</Button>
          <Button onClick={() => p.name && onSave(p)}>Enregistrer</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function HistoryTab({ sessions, exs, onDelete }: { sessions: WorkoutSession[]; exs: Exercise[]; onDelete: (id: string) => void }) {
  const grouped = useMemo(() => {
    const map: Record<string, WorkoutSession[]> = {};
    sessions.forEach((s) => { (map[s.date] ??= []).push(s); });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [sessions]);

  if (sessions.length === 0) return <div className="text-sm text-muted-foreground text-center py-8">Aucune séance terminée.</div>;

  return (
    <div className="space-y-4">
      {grouped.map(([date, list]) => (
        <div key={date}>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div>
          <div className="space-y-2">
            {list.map((s) => {
              const vol = s.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).reduce((b, x) => b + x.reps * x.weight, 0), 0);
              return (
                <div key={s.id} className="rounded-xl glass-thin p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.durationMin ?? 0} min · {Math.round(vol)} kg volume · {s.exercises.length} exercices</div>
                    </div>
                    <button onClick={() => onDelete(s.id)} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="size-3.5" /></button>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                    {s.exercises.map((e) => {
                      const m = exs.find((x) => x.id === e.exerciseId);
                      const done = e.sets.filter((x) => x.done).length;
                      return `${m?.name ?? "?"} (${done}/${e.sets.length})`;
                    }).join(" · ")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

type OverloadRow = { id: string; date: string; weight: number; reps: number; sets: number; note?: string };
type OverloadStore = Record<string, OverloadRow[]>; // exerciseId → rows


function OverloadTab({ exs }: { exs: Exercise[] }) {
  const [store, setStore] = useLocalState<OverloadStore>("lt.sport.overload", {});
  const muscles = useMemo(() => Array.from(new Set(exs.map((e) => e.muscle))), [exs]);
  const [muscle, setMuscle] = useState<string>("");
  const currentMuscle = muscle || muscles[0] || "";
  const muscleExs = exs.filter((e) => e.muscle === currentMuscle);

  const addRow = (exerciseId: string) => {
    const r: OverloadRow = { id: crypto.randomUUID(), date: todayKey(), weight: 0, reps: 0, sets: 0 };
    setStore((p) => ({ ...p, [exerciseId]: [r, ...(p[exerciseId] ?? [])] }));
  };
  const updateRow = (exerciseId: string, id: string, patch: Partial<OverloadRow>) => {
    setStore((p) => ({ ...p, [exerciseId]: (p[exerciseId] ?? []).map((r) => r.id === id ? { ...r, ...patch } : r) }));
  };
  const removeRow = (exerciseId: string, id: string) => {
    setStore((p) => ({ ...p, [exerciseId]: (p[exerciseId] ?? []).filter((r) => r.id !== id) }));
  };

  if (exs.length === 0) {
    return <div className="text-sm text-muted-foreground text-center py-8">Crée d'abord un exercice pour suivre ta surcharge progressive.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">Groupe musculaire</div>
        <div className="flex gap-1.5 flex-wrap">
          {muscles.map((m) => (
            <button
              key={m}
              onClick={() => setMuscle(m)}
              className={`px-3 py-1.5 rounded-lg text-xs ${currentMuscle === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {muscleExs.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Aucun exercice dans ce groupe.</div>
      ) : (
        <div className="space-y-4">
          {muscleExs.map((ex) => {
            const rows = (store[ex.id] ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
            const best = rows.reduce((m, r) => Math.max(m, r.weight * r.reps), 0);
            const lastW = rows[0]?.weight ?? 0;
            const prevW = rows[1]?.weight ?? 0;
            const delta = lastW - prevW;
            return (
              <div key={ex.id} className="rounded-2xl glass-card overflow-hidden">
                <div className="flex items-center justify-between gap-2 p-3 border-b border-border bg-muted/30 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{ex.name}</div>
                    {ex.equipment && <div className="text-[11px] text-muted-foreground">{ex.equipment}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    {best > 0 && <span className="px-2 py-0.5 rounded-md bg-muted">Vol. max <b>{best}</b></span>}
                    {rows.length >= 2 && (
                      <span className={`px-2 py-0.5 rounded-md ${delta > 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : delta < 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted"}`}>
                        {delta > 0 ? "↑" : delta < 0 ? "↓" : "="} {Math.abs(delta)} kg
                      </span>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => addRow(ex.id)} className="rounded-lg h-7 text-xs">
                      <Plus className="size-3 mr-0.5" />Ligne
                    </Button>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-4">Aucune entrée. Ajoute ta première série.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[520px]">
                      <div className="grid grid-cols-[110px_90px_70px_70px_1fr_36px] gap-px bg-border text-[11px] uppercase tracking-wider text-muted-foreground">
                        <div className="bg-card px-2 py-1.5">Date</div>
                        <div className="bg-card px-2 py-1.5 text-center">Poids</div>
                        <div className="bg-card px-2 py-1.5 text-center">Reps</div>
                        <div className="bg-card px-2 py-1.5 text-center">Séries</div>
                        <div className="bg-card px-2 py-1.5">Note</div>
                        <div className="bg-card px-2 py-1.5" />
                      </div>
                      {rows.map((r) => (
                        <div key={r.id} className="grid grid-cols-[110px_90px_70px_70px_1fr_36px] gap-px bg-border text-sm">
                          <div className="bg-card px-1 py-1"><Input type="date" value={r.date} onChange={(e) => updateRow(ex.id, r.id, { date: e.target.value })} className="h-8 text-xs" /></div>
                          <div className="bg-card px-1 py-1"><Input type="number" value={r.weight || ""} onChange={(e) => updateRow(ex.id, r.id, { weight: +e.target.value || 0 })} className="h-8 text-center" /></div>
                          <div className="bg-card px-1 py-1"><Input type="number" value={r.reps || ""} onChange={(e) => updateRow(ex.id, r.id, { reps: +e.target.value || 0 })} className="h-8 text-center" /></div>
                          <div className="bg-card px-1 py-1"><Input type="number" value={r.sets || ""} onChange={(e) => updateRow(ex.id, r.id, { sets: +e.target.value || 0 })} className="h-8 text-center" /></div>
                          <div className="bg-card px-1 py-1"><Input value={r.note ?? ""} onChange={(e) => updateRow(ex.id, r.id, { note: e.target.value })} placeholder="Ressenti…" className="h-8 text-xs" /></div>
                          <button onClick={() => removeRow(ex.id, r.id)} className="bg-card grid place-items-center text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

