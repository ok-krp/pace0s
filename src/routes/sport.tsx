import { createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Dumbbell, Plus, Trash2, Play, Square, Check, Pencil, Calendar as CalIcon, History, Search } from "lucide-react";
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
type Program = { id: string; name: string; emoji: string; days: number[]; items: ProgramItem[] };
type SessionSet = { reps: number; weight: number; done: boolean };
type SessionExercise = { exerciseId: string; sets: SessionSet[]; note?: string };
type WorkoutSession = { id: string; date: string; programId?: string; name: string; startedAt: number; endedAt?: number; durationMin?: number; exercises: SessionExercise[]; notes?: string };

const MUSCLES = ["Pectoraux", "Dos", "Épaules", "Biceps", "Triceps", "Quadriceps", "Ischios", "Fessiers", "Mollets", "Abdos", "Cardio", "Autre"];
const DAYS_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function SportPage() {
  const [exs, setExs] = useLocalState<Exercise[]>("pace.sport.exercises", []);
  const [progs, setProgs] = useLocalState<Program[]>("pace.sport.programs", []);
  const [sessions, setSessions] = useLocalState<WorkoutSession[]>("pace.sport.sessions", []);
  const [active, setActive] = useLocalState<WorkoutSession | null>("pace.sport.active", null);
  const [tab, setTab] = useState("programs");
  const [focusEx, setFocusEx] = useState<string | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeSelected, setFreeSelected] = useState<string[]>([]);
  const [freeSearch, setFreeSearch] = useState("");

  const openOverload = useCallback((exerciseId: string) => { setFocusEx(exerciseId); setTab("overload"); }, []);
  const todayDow = new Date().getDay();
  const todayPrograms = progs.filter((p) => p.days.includes(todayDow));

  const startSession = (program?: Program, freeExerciseIds: string[] = []) => {
    const exercises: SessionExercise[] = program
      ? program.items.map((it) => ({ exerciseId: it.exerciseId, sets: Array.from({ length: it.sets }, () => ({ reps: it.reps, weight: it.weight ?? 0, done: false })) }))
      : freeExerciseIds.map((id) => {
          const ex = exs.find((x) => x.id === id);
          return { exerciseId: id, sets: Array.from({ length: ex?.defaultSets ?? 3 }, () => ({ reps: ex?.defaultReps ?? 10, weight: ex?.defaultWeight ?? 0, done: false })) };
        });
    const s: WorkoutSession = { id: crypto.randomUUID(), date: todayKey(), programId: program?.id, name: program?.name ?? "Séance libre", startedAt: Date.now(), exercises };
    setActive(s);
    setFreeOpen(false);
    setFreeSelected([]);
    setFreeSearch("");
    toast.success("Séance démarrée");
  };

  const finishSession = () => {
    if (!active) return;
    const ended = Date.now();
    const final: WorkoutSession = { ...active, endedAt: ended, durationMin: Math.round((ended - active.startedAt) / 60000) };
    setSessions((p) => [final, ...p]);
    setActive(null);
    const perf = new Map<string, { weight: number; reps: number; sets: number }>();
    final.exercises.forEach((se) => { const done = se.sets.filter((s) => s.done); if (done.length === 0) return; const best = done.reduce((a, b) => (b.weight > a.weight ? b : a)); perf.set(se.exerciseId, { weight: best.weight, reps: best.reps, sets: done.length }); });
    setExs((p) => p.map((e) => { const pf = perf.get(e.id); return pf ? { ...e, defaultWeight: pf.weight, defaultReps: pf.reps, defaultSets: pf.sets } : e; }));
    setProgs((p) => p.map((prog) => ({ ...prog, items: prog.items.map((it) => { const pf = perf.get(it.exerciseId); return pf ? { ...it, weight: pf.weight, reps: pf.reps, sets: pf.sets } : it; }) })));
    toast.success(`Séance terminée — ${final.durationMin} min`);
  };
  const cancelSession = () => { if (!confirm("Abandonner la séance en cours ?")) return; setActive(null); };

  const last7 = lastNDays(7);
  const sessionsThisWeek = sessions.filter((s) => last7.includes(s.date));
  const daysActive = new Set(sessionsThisWeek.map((s) => s.date)).size;
  const filteredFreeExercises = useMemo(() => exs.filter((e) => `${e.name} ${e.muscle}`.toLowerCase().includes(freeSearch.toLowerCase())), [exs, freeSearch]);

  return (
    <div>
      <PageHeader title="Sport" subtitle="Tes exercices, tes programmes, tes séances — à ton image." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <StatCard label="Séances des 7 derniers jours" value={sessionsThisWeek.length} unit={sessionsThisWeek.length > 1 ? "séances" : "séance"} icon={<Dumbbell className="size-4" />} />
        <StatCard label="Jours actifs (sur 7)" value={`${daysActive} / 7`} icon={<CalIcon className="size-4" />} />
      </div>

      {active ? <ActiveSession active={active} setActive={setActive} exs={exs} onFinish={finishSession} onCancel={cancelSession} /> : (
        <div className="rounded-2xl glass-card p-4 sm:p-5 mb-3">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h2 className="font-display text-base sm:text-lg font-semibold flex items-center gap-2"><CalIcon className="size-4 text-muted-foreground" /> Aujourd'hui ({DAYS_LABELS[todayDow]})</h2>
          </div>
          {todayPrograms.length === 0 ? (
            <div className="rounded-xl glass-thin p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div><div className="text-sm text-muted-foreground">Aucun programme prévu aujourd'hui.</div><div className="text-xs text-muted-foreground/80 mt-1">Choisis directement les exercices de ta séance.</div></div>
              <Button onClick={() => setFreeOpen(true)} className="rounded-xl shrink-0"><Dumbbell className="size-4 mr-1.5" />Séance libre</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid sm:grid-cols-2 gap-2">
                {todayPrograms.map((p) => <div key={p.id} className="rounded-xl glass-thin p-3 flex items-center gap-3"><div className="text-2xl">{p.emoji}</div><div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div><div className="text-xs text-muted-foreground">{p.items.length} exercice{p.items.length === 1 ? "" : "s"}</div></div><Button size="sm" onClick={() => startSession(p)} className="rounded-lg"><Play className="size-3 mr-1" />Démarrer</Button></div>)}
              </div>
              <div className="flex justify-center pt-1"><Button variant="outline" size="sm" onClick={() => setFreeOpen(true)} className="rounded-xl"><Dumbbell className="size-3.5 mr-1.5" />Séance libre</Button></div>
            </div>
          )}
        </div>
      )}

      <Dialog open={freeOpen} onOpenChange={(open) => { setFreeOpen(open); if (!open) { setFreeSelected([]); setFreeSearch(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Dumbbell className="size-5" />Séance libre</DialogTitle></DialogHeader>
          {exs.length === 0 ? <div className="py-6 text-sm text-muted-foreground">Crée d'abord au moins un exercice dans l'onglet Exercices.</div> : <div className="space-y-4">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input value={freeSearch} onChange={(e) => setFreeSearch(e.target.value)} placeholder="Rechercher un exercice…" className="pl-9" /></div>
            <div className="max-h-64 overflow-y-auto grid sm:grid-cols-2 gap-2 pr-1">{filteredFreeExercises.map((e) => { const selected = freeSelected.includes(e.id); return <button key={e.id} type="button" onClick={() => setFreeSelected((p) => selected ? p.filter((id) => id !== e.id) : [...p, e.id])} className={`rounded-xl border p-3 text-left flex items-center gap-3 transition ${selected ? "border-primary bg-primary/10" : "hover:bg-muted/50"}`}><span className={`size-5 rounded-md grid place-items-center border shrink-0 ${selected ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{selected && <Check className="size-3.5" />}</span><span className="min-w-0"><span className="block font-medium truncate">{e.name}</span><span className="block text-xs text-muted-foreground">{e.muscle}{e.defaultWeight ? ` · ${e.defaultWeight} kg` : ""}</span></span></button>; })}</div>
            {freeSelected.length > 0 && <div className="rounded-xl glass-thin p-3"><div className="text-xs text-muted-foreground mb-2">Exercices sélectionnés ({freeSelected.length})</div><div className="flex flex-wrap gap-1.5">{freeSelected.map((id, i) => { const e = exs.find((x) => x.id === id); return <button key={id} onClick={() => setFreeSelected((p) => p.filter((x) => x !== id))} className="px-2.5 py-1 rounded-lg bg-primary/10 text-xs hover:bg-primary/20">{i + 1}. {e?.name ?? "Exercice"} ×</button>; })}</div></div>}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setFreeOpen(false)}>Annuler</Button><Button disabled={freeSelected.length === 0} onClick={() => startSession(undefined, freeSelected)}><Play className="size-4 mr-1.5" />Démarrer la séance</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="overflow-x-auto -mx-1 px-1 mb-2 scrollbar-hide"><TabsList className="inline-flex w-max min-w-full"><TabsTrigger value="programs" className="text-xs sm:text-sm">Programmes</TabsTrigger><TabsTrigger value="exercises" className="text-xs sm:text-sm">Exercices</TabsTrigger><TabsTrigger value="overload" className="text-xs sm:text-sm"><TrendingUp className="size-3 mr-1" />Surcharge</TabsTrigger><TabsTrigger value="history" className="text-xs sm:text-sm"><History className="size-3 mr-1" />Historique</TabsTrigger></TabsList></div>
        <TabsContent value="programs"><ProgramsTab progs={progs} setProgs={setProgs} exs={exs} onOpenExercise={openOverload} /></TabsContent>
        <TabsContent value="exercises"><ExercisesTab exs={exs} setExs={setExs} /></TabsContent>
        <TabsContent value="overload"><OverloadTab exs={exs} setExs={setExs} progs={progs} setProgs={setProgs} sessions={sessions} focusExerciseId={focusEx} /></TabsContent>
        <TabsContent value="history"><HistoryTab sessions={sessions} exs={exs} onDelete={(id) => setSessions((p) => p.filter((s) => s.id !== id))} /></TabsContent>
      </Tabs>
    </div>
  );
}

function ActiveSession({ active, setActive, exs, onFinish, onCancel }: { active: WorkoutSession; setActive: (v: WorkoutSession | null) => void; exs: Exercise[]; onFinish: () => void; onCancel: () => void }) {
  const updateSet = (exIdx: number, setIdx: number, patch: Partial<SessionSet>) => setActive({ ...active, exercises: active.exercises.map((e, i) => i !== exIdx ? e : { ...e, sets: e.sets.map((s, j) => j !== setIdx ? s : { ...s, ...patch }) }) });
  const addSet = (exIdx: number) => { const last = active.exercises[exIdx].sets.slice(-1)[0]; setActive({ ...active, exercises: active.exercises.map((e, i) => i !== exIdx ? e : { ...e, sets: [...e.sets, { reps: last?.reps ?? 8, weight: last?.weight ?? 0, done: false }] }) }); };
  const addExercise = (id: string) => setActive({ ...active, exercises: [...active.exercises, { exerciseId: id, sets: [{ reps: 8, weight: 0, done: false }] }] });
  const removeExercise = (idx: number) => setActive({ ...active, exercises: active.exercises.filter((_, i) => i !== idx) });
  return <div className="rounded-2xl glass-card p-5 mb-4"><div className="flex items-center justify-between mb-3 flex-wrap gap-2"><div><div className="text-xs text-primary font-medium uppercase tracking-wider">Séance en cours</div><h2 className="font-display text-xl font-semibold">{active.name}</h2></div><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={onCancel}>Annuler</Button><Button onClick={onFinish} className="rounded-xl"><Square className="size-3 mr-1" />Terminer</Button></div></div><div className="space-y-3">{active.exercises.map((e, exIdx) => { const meta = exs.find((x) => x.id === e.exerciseId); return <div key={exIdx} className="rounded-xl glass-thin p-3"><div className="flex items-center justify-between mb-2"><div className="font-medium">{meta?.name ?? "Exercice"} <span className="text-xs text-muted-foreground">{meta?.muscle}</span></div><button onClick={() => removeExercise(exIdx)} aria-label="Retirer cet exercice" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></div><div className="space-y-1.5">{e.sets.map((s, j) => <div key={j} className="flex items-center gap-2"><span className="text-xs text-muted-foreground w-6">{j + 1}.</span><Input type="number" value={s.weight || ""} onChange={(ev) => updateSet(exIdx, j, { weight: +ev.target.value || 0 })} placeholder="kg" className="h-8 w-20 text-sm" /><span className="text-xs text-muted-foreground">×</span><Input type="number" value={s.reps || ""} onChange={(ev) => updateSet(exIdx, j, { reps: +ev.target.value || 0 })} placeholder="reps" className="h-8 w-20 text-sm" /><button onClick={() => updateSet(exIdx, j, { done: !s.done })} className={`size-7 rounded-md grid place-items-center ${s.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><Check className="size-3.5" /></button></div>)}<Button variant="ghost" size="sm" onClick={() => addSet(exIdx)} className="h-7 text-xs"><Plus className="size-3 mr-1" />Série</Button></div></div>})}<Select onValueChange={(v) => addExercise(v)}><SelectTrigger className="rounded-xl"><SelectValue placeholder="+ Ajouter un exercice" /></SelectTrigger><SelectContent>{exs.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} — {x.muscle}</SelectItem>)}</SelectContent></Select></div></div>;
}

const ExercisesTab = memo(function ExercisesTab({ exs, setExs }: { exs: Exercise[]; setExs: (v: Exercise[] | ((p: Exercise[]) => Exercise[])) => void }) {
  const [editing, setEditing] = useState<Exercise | null>(null); const [open, setOpen] = useState(false);
  const save = (e: Exercise) => { setExs((p) => { const i = p.findIndex((x) => x.id === e.id); if (i >= 0) { const n = [...p]; n[i] = e; return n; } return [...p, e]; }); setEditing(null); setOpen(false); };
  return <div className="space-y-3"><Button onClick={() => { setEditing({ id: crypto.randomUUID(), name: "", muscle: MUSCLES[0] }); setOpen(true); }} className="rounded-xl"><Plus className="size-4 mr-1" />Nouvel exercice</Button><Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>{editing && <ExerciseForm key={editing.id} ex={editing} onSave={save} onCancel={() => { setEditing(null); setOpen(false); }} />}</Dialog>{exs.length === 0 ? <div className="text-sm text-muted-foreground text-center py-8">Aucun exercice. Crée-en un pour commencer.</div> : <div className="grid sm:grid-cols-2 gap-2">{exs.map((e) => <div key={e.id} className="rounded-xl glass-thin p-3 flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-medium">{e.name}</div><div className="text-xs text-muted-foreground">{e.muscle}{e.equipment ? ` · ${e.equipment}` : ""}</div>{e.notes && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.notes}</div>}</div><div className="flex gap-1 shrink-0"><button onClick={() => { setEditing(e); setOpen(true); }} className="text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /></button><button onClick={() => setExs((p) => p.filter((x) => x.id !== e.id))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></div></div>)}</div>}</div>;
});

function ExerciseForm({ ex, onSave, onCancel }: { ex: Exercise | null; onSave: (e: Exercise) => void; onCancel: () => void }) { const [e, setE] = useState<Exercise | null>(ex); if (!e) return null; const up = <K extends keyof Exercise>(k: K, v: Exercise[K]) => setE({ ...e, [k]: v }); return <DialogContent><DialogHeader><DialogTitle>{ex?.name ? "Modifier" : "Nouvel exercice"}</DialogTitle></DialogHeader><div className="space-y-3"><Input placeholder="Nom" value={e.name} onChange={(ev) => up("name", ev.target.value)} /><Select value={e.muscle} onValueChange={(v) => up("muscle", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MUSCLES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select><Input placeholder="Matériel" value={e.equipment ?? ""} onChange={(ev) => up("equipment", ev.target.value)} /><Textarea placeholder="Notes" value={e.notes ?? ""} onChange={(ev) => up("notes", ev.target.value)} rows={3} /><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Annuler</Button><Button onClick={() => e.name && onSave(e)}>Enregistrer</Button></div></div></DialogContent>; }

const ProgramsTab = memo(function ProgramsTab({ progs, setProgs, exs, onOpenExercise }: { progs: Program[]; setProgs: (v: Program[] | ((p: Program[]) => Program[])) => void; exs: Exercise[]; onOpenExercise: (exerciseId: string) => void }) {
  const [editing, setEditing] = useState<Program | null>(null); const [open, setOpen] = useState(false); const [openedId, setOpenedId] = useState<string | null>(null);
  const save = (p: Program) => { setProgs((prev) => { const i = prev.findIndex((x) => x.id === p.id); if (i >= 0) { const n = [...prev]; n[i] = p; return n; } return [...prev, p]; }); setEditing(null); setOpen(false); };
  const opened = progs.find((p) => p.id === openedId) ?? null;
  if (opened) { const groups = new Map<string, { item: ProgramItem; ex: Exercise }[]>(); opened.items.forEach((item) => { const ex = exs.find((x) => x.id === item.exerciseId); if (!ex) return; const arr = groups.get(ex.muscle) ?? []; arr.push({ item, ex }); groups.set(ex.muscle, arr); }); return <div className="space-y-3"><button onClick={() => setOpenedId(null)} className="text-sm text-muted-foreground hover:text-foreground">← Programmes</button><div className="rounded-2xl glass-card p-4"><div className="flex items-center gap-2 mb-1"><span className="text-2xl">{opened.emoji}</span><div><h2 className="font-display text-lg font-semibold">{opened.name}</h2><div className="text-xs text-muted-foreground">{opened.items.length} exercices · {opened.days.map((d) => DAYS_LABELS[d]).join(" · ") || "Aucun jour"}</div></div></div></div>{groups.size === 0 ? <div className="text-sm text-muted-foreground text-center py-8">Aucun exercice dans ce programme.</div> : [...groups.entries()].map(([muscle, list]) => <div key={muscle} className="space-y-1.5"><div className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">{muscle}</div>{list.map(({ item, ex }) => <button key={ex.id + item.exerciseId} onClick={() => onOpenExercise(ex.id)} className="w-full text-left rounded-xl glass-thin p-3 flex items-center justify-between gap-3"><div className="min-w-0"><div className="font-medium truncate">{ex.name}</div><div className="text-xs text-muted-foreground">{item.sets} × {item.reps}{item.weight ? ` · ${item.weight} kg` : ""}{ex.equipment ? ` · ${ex.equipment}` : ""}</div></div><span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1"><TrendingUp className="size-3" />Surcharge →</span></button>)}</div>)}</div>; }
  return <div className="space-y-3"><Button onClick={() => { setEditing({ id: crypto.randomUUID(), name: "", emoji: "💪", days: [], items: [] }); setOpen(true); }} className="rounded-xl" disabled={exs.length === 0}><Plus className="size-4 mr-1" />Nouveau programme</Button><Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>{editing && <ProgramForm key={editing.id} prog={editing} exs={exs} onSave={save} onCancel={() => { setEditing(null); setOpen(false); }} />}</Dialog>{progs.length === 0 ? <div className="text-sm text-muted-foreground text-center py-8">Aucun programme.</div> : <div className="grid sm:grid-cols-2 gap-2">{progs.map((p) => <div key={p.id} className="rounded-xl glass-thin p-3"><div className="flex items-start justify-between gap-2"><button onClick={() => setOpenedId(p.id)} className="flex items-center gap-2 min-w-0 text-left flex-1"><div className="text-2xl">{p.emoji}</div><div className="min-w-0"><div className="font-medium truncate">{p.name}</div><div className="text-xs text-muted-foreground">{p.days.map((d) => DAYS_LABELS[d]).join(" · ") || "Aucun jour"} · {p.items.length} ex.</div></div></button><div className="flex gap-1 shrink-0"><button onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="size-3.5" /></button><button onClick={() => setProgs((prev) => prev.filter((x) => x.id !== p.id))}><Trash2 className="size-3.5" /></button></div></div></div>)}</div>}</div>;
});

function ProgramForm({ prog, exs, onSave, onCancel }: { prog: Program | null; exs: Exercise[]; onSave: (p: Program) => void; onCancel: () => void }) { const [p, setP] = useState<Program | null>(prog); if (!p) return null; const up = <K extends keyof Program>(k: K, v: Program[K]) => setP({ ...p, [k]: v }); const toggleDay = (d: number) => up("days", p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d]); const addItem = (id: string) => up("items", [...p.items, { exerciseId: id, sets: 3, reps: 10 }]); const updateItem = (i: number, patch: Partial<ProgramItem>) => up("items", p.items.map((it, idx) => idx !== i ? it : { ...it, ...patch })); const removeItem = (i: number) => up("items", p.items.filter((_, idx) => idx !== i)); return <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{prog?.name ? "Modifier" : "Nouveau programme"}</DialogTitle></DialogHeader><div className="space-y-3 max-h-[70vh] overflow-y-auto"><div className="flex gap-2"><Input value={p.emoji} onChange={(e) => up("emoji", e.target.value)} className="w-16 text-center" maxLength={2} /><Input placeholder="Nom" value={p.name} onChange={(e) => up("name", e.target.value)} className="flex-1" /></div><div><div className="text-xs text-muted-foreground mb-1">Jours</div><div className="flex gap-1 flex-wrap">{DAYS_LABELS.map((d, i) => <button key={i} onClick={() => toggleDay(i)} className={`px-3 py-1.5 rounded-lg text-xs ${p.days.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{d}</button>)}</div></div><div><div className="text-xs text-muted-foreground mb-1">Exercices</div><div className="space-y-2">{p.items.map((it, i) => { const meta = exs.find((x) => x.id === it.exerciseId); return <div key={i} className="flex items-center gap-1.5 text-sm"><span className="flex-1 truncate">{meta?.name ?? "?"}</span><Input type="number" value={it.sets} onChange={(e) => updateItem(i, { sets: +e.target.value || 1 })} className="h-8 w-14" /><span className="text-xs text-muted-foreground">×</span><Input type="number" value={it.reps} onChange={(e) => updateItem(i, { reps: +e.target.value || 1 })} className="h-8 w-14" /><Input type="number" placeholder="kg" value={it.weight ?? ""} onChange={(e) => updateItem(i, { weight: +e.target.value || 0 })} className="h-8 w-16" /><button onClick={() => removeItem(i)}><Trash2 className="size-3.5" /></button></div>; })}<Select onValueChange={(v) => addItem(v)}><SelectTrigger className="h-8"><SelectValue placeholder="+ Ajouter un exercice" /></SelectTrigger><SelectContent>{exs.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div></div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Annuler</Button><Button onClick={() => p.name && onSave(p)}>Enregistrer</Button></div></div></DialogContent>; }

const HistoryTab = memo(function HistoryTab({ sessions, exs, onDelete }: { sessions: WorkoutSession[]; exs: Exercise[]; onDelete: (id: string) => void }) { const grouped = useMemo(() => { const map: Record<string, WorkoutSession[]> = {}; sessions.forEach((s) => { (map[s.date] ??= []).push(s); }); return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])); }, [sessions]); if (sessions.length === 0) return <div className="text-sm text-muted-foreground text-center py-8">Aucune séance terminée.</div>; return <div className="space-y-4">{grouped.map(([date, list]) => <div key={date}><div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div><div className="space-y-2">{list.map((s) => <div key={s.id} className="rounded-xl glass-thin p-3"><div className="flex items-start justify-between gap-2"><div><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.durationMin ?? 0} min · {s.exercises.length} exercices</div></div><button onClick={() => onDelete(s.id)}><Trash2 className="size-3.5" /></button></div></div>)}</div></div>)}</div>; });

type OverloadRow = { id: string; date: string; weight: number; reps: number; sets: number; note?: string; source: "session" | "manual" };
type OverloadStore = Record<string, OverloadRow[]>;
function deriveSessionRows(sessions: WorkoutSession[], exerciseId: string): OverloadRow[] { const rows: OverloadRow[] = []; for (const s of sessions) { const se = s.exercises.find((e) => e.exerciseId === exerciseId); if (!se) continue; const done = se.sets.filter((x) => x.done); if (!done.length) continue; const best = done.reduce((a, b) => (b.weight > a.weight ? b : a)); rows.push({ id: `sess-${s.id}`, date: s.date, weight: best.weight, reps: best.reps, sets: done.length, note: se.note, source: "session" }); } return rows; }

const OverloadTab = memo(function OverloadTab({ exs, setExs, progs, setProgs, sessions, focusExerciseId }: { exs: Exercise[]; setExs: (v: Exercise[] | ((p: Exercise[]) => Exercise[])) => void; progs: Program[]; setProgs: (v: Program[] | ((p: Program[]) => Program[])) => void; sessions: WorkoutSession[]; focusExerciseId?: string | null }) {
  const [manualStore, setManualStore] = useLocalState<OverloadStore>("pace.sport.overload", {});
  const rowsByExercise = useMemo(() => { const map: Record<string, OverloadRow[]> = {}; exs.forEach((e) => { map[e.id] = [...deriveSessionRows(sessions, e.id), ...(manualStore[e.id] ?? [])].sort((a, b) => b.date.localeCompare(a.date)); }); return map; }, [exs, sessions, manualStore]);
  const muscles = useMemo(() => Array.from(new Set(exs.map((e) => e.muscle))), [exs]);
  const [muscle, setMuscle] = useState(""); const currentMuscle = muscle || muscles[0] || "";
  const muscleExs = useMemo(() => exs.filter((e) => e.muscle === currentMuscle), [exs, currentMuscle]);
  const targets = useMemo(() => { const map: Record<string, { sets: number; reps: number; weight: number }> = {}; exs.forEach((e) => { map[e.id] = { sets: e.defaultSets ?? 3, reps: e.defaultReps ?? 10, weight: e.defaultWeight ?? 0 }; }); progs.forEach((p) => p.items.forEach((it) => { map[it.exerciseId] = { sets: it.sets, reps: it.reps, weight: it.weight ?? map[it.exerciseId]?.weight ?? 0 }; })); return map; }, [exs, progs]);
  useEffect(() => { if (!focusExerciseId) return; const target = exs.find((e) => e.id === focusExerciseId); if (!target) return; setMuscle(target.muscle); const id = requestAnimationFrame(() => document.getElementById(`ov-${focusExerciseId}`)?.scrollIntoView({ block: "start", behavior: "smooth" })); return () => cancelAnimationFrame(id); }, [focusExerciseId, exs]);
  const syncExerciseFromRow = (exerciseId: string, r: OverloadRow) => { setExs((p) => p.map((e) => e.id === exerciseId ? { ...e, defaultWeight: r.weight, defaultReps: r.reps, defaultSets: r.sets } : e)); setProgs((p) => p.map((prog) => ({ ...prog, items: prog.items.map((it) => it.exerciseId === exerciseId ? { ...it, weight: r.weight, reps: r.reps, sets: r.sets } : it) }))); };
  const addRow = (exerciseId: string) => { const tgt = targets[exerciseId] ?? { sets: 3, reps: 10, weight: 0 }; const prev = (rowsByExercise[exerciseId] ?? [])[0]; const r: OverloadRow = { id: crypto.randomUUID(), date: todayKey(), weight: prev?.weight ?? tgt.weight, reps: tgt.reps, sets: tgt.sets, source: "manual" }; setManualStore((p) => ({ ...p, [exerciseId]: [r, ...(p[exerciseId] ?? [])] })); syncExerciseFromRow(exerciseId, r); };
  const updateRow = (exerciseId: string, id: string, patch: Partial<OverloadRow>) => { let updated: OverloadRow | null = null; setManualStore((p) => ({ ...p, [exerciseId]: (p[exerciseId] ?? []).map((r) => { if (r.id !== id) return r; updated = { ...r, ...patch }; return updated; }) })); if (updated && (rowsByExercise[exerciseId] ?? [])[0]?.id === id) syncExerciseFromRow(exerciseId, updated); };
  const removeRow = (exerciseId: string, id: string) => setManualStore((p) => ({ ...p, [exerciseId]: (p[exerciseId] ?? []).filter((r) => r.id !== id) }));
  if (!exs.length) return <div className="text-sm text-muted-foreground text-center py-8">Crée d'abord un exercice pour suivre ta surcharge progressive.</div>;
  return <div className="space-y-4"><div><div className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">Groupe musculaire</div><div className="flex gap-1.5 flex-wrap">{muscles.map((m) => <button key={m} onClick={() => setMuscle(m)} className={`px-3 py-1.5 rounded-lg text-xs ${currentMuscle === m ? "glass-thin text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>{m}</button>)}</div></div>{muscleExs.map((ex) => { const rows = rowsByExercise[ex.id] ?? []; const tgt = targets[ex.id]; return <div key={ex.id} id={`ov-${ex.id}`} className="rounded-2xl glass-card overflow-hidden"><div className="flex items-center justify-between gap-2 p-3 border-b border-border/50"><div><div className="font-medium">{ex.name}</div><div className="text-xs text-muted-foreground">{ex.equipment}</div></div><Button size="sm" variant="secondary" onClick={() => addRow(ex.id)}><Plus className="size-3 mr-1" />Ligne manuelle</Button></div><div className="p-3 text-xs text-muted-foreground">Cible : {tgt.sets} × {tgt.reps} · {tgt.weight} kg · {rows.length} entrée(s)</div></div>; })}</div>;
});
