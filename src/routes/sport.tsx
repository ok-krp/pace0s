import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Dumbbell, Plus, Trash2, Play, Square, Check, Pencil, Calendar as CalIcon, History, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, todayKey, lastNDays } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SportExercisePicker } from "@/components/SportExercisePicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateSportProgression } from "@/lib/sport-progression.functions";

export const Route = createFileRoute("/sport")({
  head: () => ({ meta: [{ title: "Sport — Pace" }, { name: "description", content: "Exercices, programmes, séances : votre suivi sportif tout-en-un." }] }),
  component: SportPage,
});

type Exercise = { id: string; name: string; muscle: string; equipment?: string; notes?: string; defaultSets?: number; defaultReps?: number; defaultWeight?: number; restSec?: number };
type ProgramItem = { exerciseId: string; sets: number; reps: number; weight?: number; restSec?: number };
type Program = { id: string; name: string; emoji: string; days: number[]; items: ProgramItem[]; isArchived?: boolean };
type SessionSet = { reps: number; weight: number; done: boolean };
type SessionExercise = { exerciseId: string; sets: SessionSet[]; note?: string };
type WorkoutSession = { id: string; date: string; programId?: string; name: string; startedAt: number; endedAt?: number; durationMin?: number; exercises: SessionExercise[]; notes?: string };
type ProgressionTarget = { exerciseId: string; targetSets: number; targetReps: number; targetWeight: number; strategy: string; rationale: string; basedOnSessionId: string };
const MUSCLES = ["Pectoraux", "Dos", "Épaules", "Biceps", "Triceps", "Jambes", "Quadriceps", "Ischios", "Fessiers", "Mollets", "Abdos", "Cardio", "Autre"];
const DAYS_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function getWorkingSets(sets: SessionSet[]) {
  const done = sets.filter((set) => set.done);
  if (done.length < 3) return done;
  const maxWeight = Math.max(...done.map((set) => set.weight));
  if (maxWeight <= 0) return done;
  const last = done[done.length - 1];
  const isDropSet = last.weight > 0 && last.weight <= maxWeight * 0.85 && done.length >= 4;
  return isDropSet ? done.slice(0, -1) : done;
}

function SportPage() {
  const [exs, setExs] = useLocalState<Exercise[]>("pace.sport.exercises", []);
  const [progs, setProgs] = useLocalState<Program[]>("pace.sport.programs", []);
  const [sessions, setSessions] = useLocalState<WorkoutSession[]>("pace.sport.sessions", []);
  const [active, setActive] = useLocalState<WorkoutSession | null>("pace.sport.active", null);
  const [targets, setTargets] = useState<Record<string, ProgressionTarget>>({});
  const [cloudHistoryReady, setCloudHistoryReady] = useState(false);
  const [progressionLoading, setProgressionLoading] = useState(false);
  const generateProgression = useServerFn(generateSportProgression);
  const [tab, setTab] = useState("programs");
  const [focusEx, setFocusEx] = useState<string | null>(null);
  const openOverload = useCallback((exerciseId: string) => { setFocusEx(exerciseId); setTab("overload"); }, []);
  const todayDow = new Date().getDay();

  const loadCloudSportHistory = useCallback(async () => {
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) return;
    const [{ data: cloudSessions, error: sessionError }, { data: cloudTargets, error: targetError }] = await Promise.all([
      supabase.from("sport_workout_sessions").select("id,program_id,name,workout_date,started_at,ended_at,duration_min,notes,sport_workout_exercises(id,exercise_id,position,note,sport_workout_sets(id,set_number,reps,weight,done))").eq("user_id", userData.user.id).order("workout_date", { ascending: false }).limit(200),
      supabase.from("sport_progression_targets").select("exercise_id,target_sets,target_reps,target_weight,strategy,rationale,based_on_session_id").eq("user_id", userData.user.id),
    ]);
    if (!sessionError && cloudSessions) {
      const mapped = (cloudSessions as unknown as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), date: String(row.workout_date), programId: row.program_id ? String(row.program_id) : undefined, name: String(row.name),
        startedAt: Date.parse(String(row.started_at)), endedAt: row.ended_at ? Date.parse(String(row.ended_at)) : undefined,
        durationMin: row.duration_min == null ? undefined : Number(row.duration_min), notes: row.notes ? String(row.notes) : undefined,
        exercises: (Array.isArray(row.sport_workout_exercises) ? row.sport_workout_exercises : []).map((exercise) => {
          const item = exercise as Record<string, unknown>;
          return { exerciseId: String(item.exercise_id), note: item.note ? String(item.note) : undefined, sets: (Array.isArray(item.sport_workout_sets) ? item.sport_workout_sets : []).map((set) => { const s = set as Record<string, unknown>; return { setNumber: Number(s.set_number ?? 0), reps: Number(s.reps ?? 0), weight: Number(s.weight ?? 0), done: Boolean(s.done) }; }).sort((a, b) => a.setNumber - b.setNumber).map(({ reps, weight, done }) => ({ reps, weight, done })) };
        }),
      })).filter((session) => Number.isFinite(session.startedAt));
      setSessions((current) => {
        const byId = new Map<string, WorkoutSession>();
        for (const session of current) byId.set(session.id, session);
        for (const session of mapped) byId.set(session.id, session);
        return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt);
      });
    }
    if (!targetError && cloudTargets) {
      setTargets(Object.fromEntries((cloudTargets as Array<Record<string, unknown>>).map((row) => [String(row.exercise_id), {
        exerciseId: String(row.exercise_id), targetSets: Number(row.target_sets), targetReps: Number(row.target_reps), targetWeight: Number(row.target_weight),
        strategy: String(row.strategy), rationale: String(row.rationale ?? ""), basedOnSessionId: String(row.based_on_session_id ?? ""),
      }])));
    }
    setCloudHistoryReady(!sessionError);
  }, [setSessions]);

  useEffect(() => { void loadCloudSportHistory(); }, [loadCloudSportHistory]);

  useEffect(() => {
    let cancelled = false;
    const hydrateSportState = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled || !userData.user) return;
      const { data, error } = await supabase
        .from("user_state")
        .select("key,value")
        .eq("user_id", userData.user.id)
        .in("key", ["pace.sport.exercises", "pace.sport.programs"]);
      if (cancelled || error || !data) return;
      for (const row of data as Array<{ key: string; value: unknown }>) {
        if (row.key === "pace.sport.exercises" && Array.isArray(row.value)) {
          setExs((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            for (const item of row.value as Exercise[]) if (item?.id) byId.set(item.id, item);
            return [...byId.values()];
          });
        }
        if (row.key === "pace.sport.programs" && Array.isArray(row.value)) {
          setProgs((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            for (const item of row.value as Program[]) if (item?.id) byId.set(item.id, item);
            return [...byId.values()];
          });
        }
      }
    };
    void hydrateSportState();
    return () => { cancelled = true; };
  }, [setExs, setProgs]);

  const lastPerformance = useCallback((exerciseId: string) => {
    const previous = sessions.filter((session) => session.exercises.some((item) => item.exerciseId === exerciseId)).sort((a, b) => b.date.localeCompare(a.date))[0];
    const exercise = previous?.exercises.find((item) => item.exerciseId === exerciseId);
    const done = exercise?.sets.filter((set) => set.done) ?? [];
    return done.length ? { sets: done.map((set) => ({ ...set })), sessionId: previous!.id } : null;
  }, [sessions]);

  const persistCloudSession = useCallback(async (session: WorkoutSession, availableExercises: Exercise[]) => {
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) throw new Error("Session Supabase expirée.");

    const userId = userData.user.id;
    const normalizedExercises = session.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({
        ...set,
        // The database enforces reps > 0. Empty numeric inputs must never
        // turn into an invalid 0-rep set at finish time.
        reps: Math.max(1, Math.trunc(Number(set.reps) || 1)),
        weight: Math.max(0, Number(set.weight) || 0),
      })),
    }));

    const normalizedSession: WorkoutSession = {
      ...session,
      exercises: normalizedExercises,
    };

    // Local Sport state is synced asynchronously. Make the finish action
    // resilient when an exercise/program was created moments earlier and is
    // not in Supabase yet.
    const exerciseIds = [...new Set(normalizedExercises.map((exercise) => exercise.exerciseId))];
    if (exerciseIds.length) {
      const { data: existingExercises, error: existingExercisesError } = await supabase
        .from("sport_exercises")
        .select("id")
        .eq("user_id", userId)
        .in("id", exerciseIds);
      if (existingExercisesError) throw existingExercisesError;

      const existingIds = new Set((existingExercises ?? []).map((row) => String(row.id)));
      const missingExercises = availableExercises
        .filter((exercise) => exerciseIds.includes(exercise.id) && !existingIds.has(exercise.id))
        .map((exercise) => ({
          id: exercise.id,
          user_id: userId,
          name: exercise.name,
          muscle: exercise.muscle,
          equipment: exercise.equipment ?? null,
          notes: exercise.notes ?? null,
          default_sets: exercise.defaultSets ?? null,
          default_reps: exercise.defaultReps ?? null,
          default_weight: exercise.defaultWeight ?? null,
          rest_sec: exercise.restSec ?? null,
        }));

      if (missingExercises.length) {
        const { error: exerciseSyncError } = await supabase.from("sport_exercises").insert(missingExercises);
        if (exerciseSyncError) throw exerciseSyncError;
      }

      if (existingIds.size + missingExercises.length < exerciseIds.length) {
        throw new Error("Un ou plusieurs exercices de la séance ne sont plus disponibles dans Supabase.");
      }
    }

    let programId = normalizedSession.programId ?? null;
    if (programId) {
      const { data: program, error: programError } = await supabase
        .from("sport_programs")
        .select("id")
        .eq("user_id", userId)
        .eq("id", programId)
        .maybeSingle();
      if (programError) throw programError;
      // A stale local program must not prevent the workout itself from being saved.
      if (!program) programId = null;
    }

    // Make retries idempotent: if a previous attempt partially inserted the
    // session before failing on a child row, remove that partial tree first.
    await supabase.rpc("sport_delete_workout", { p_id: normalizedSession.id });

    const { error: sessionError } = await supabase.from("sport_workout_sessions").insert({
      id: normalizedSession.id,
      user_id: userId,
      program_id: programId,
      name: normalizedSession.name,
      workout_date: normalizedSession.date,
      started_at: new Date(normalizedSession.startedAt).toISOString(),
      ended_at: normalizedSession.endedAt ? new Date(normalizedSession.endedAt).toISOString() : null,
      duration_min: normalizedSession.durationMin ?? null,
      notes: normalizedSession.notes ?? null,
      is_temporary: false,
    });
    if (sessionError) throw sessionError;

    try {
      const workoutExercises = normalizedExercises.map((exercise, position) => ({
        id: crypto.randomUUID(),
        session_id: normalizedSession.id,
        exercise_id: exercise.exerciseId,
        position,
        note: exercise.note ?? null,
      }));

      if (workoutExercises.length) {
        const { error: exerciseError } = await supabase.from("sport_workout_exercises").insert(workoutExercises);
        if (exerciseError) throw exerciseError;

        const sets = normalizedExercises.flatMap((exercise, exerciseIndex) =>
          exercise.sets.map((set, setIndex) => ({
            id: crypto.randomUUID(),
            workout_exercise_id: workoutExercises[exerciseIndex].id,
            set_number: setIndex + 1,
            reps: set.reps,
            weight: set.weight,
            done: set.done,
          })),
        );

        if (sets.length) {
          const { error: setError } = await supabase.from("sport_workout_sets").insert(sets);
          if (setError) throw setError;
        }
      }
    } catch (error) {
      await supabase.rpc("sport_delete_workout", { p_id: normalizedSession.id });
      throw error;
    }
  }, []);  const todayPrograms = progs.filter((p) => !p.isArchived && p.days.includes(todayDow));
  const startSession = (program?: Program) => {
    const exercises: SessionExercise[] = program ? program.items.map((it) => {
      const last = lastPerformance(it.exerciseId);
      const source = last?.sets?.length ? last.sets : Array.from({ length: it.sets }, () => ({ reps: it.reps, weight: it.weight ?? 0, done: false }));
      return { exerciseId: it.exerciseId, sets: source.map((set) => ({ reps: set.reps, weight: set.weight, done: false })) };
    }) : [];
    const s: WorkoutSession = { id: crypto.randomUUID(), date: todayKey(), programId: program?.id, name: program?.name ?? "Séance libre", startedAt: Date.now(), exercises };
    setActive(s); toast.success("Séance démarrée", { description: program ? "Les séries démarrent avec les performances de la dernière séance." : undefined });
  };
  const finishSession = async () => {
    if (!active || progressionLoading) return;
    const ended = Date.now();
    const final: WorkoutSession = { ...active, endedAt: ended, durationMin: Math.round((ended - active.startedAt) / 60000) };
    setProgressionLoading(true);
    try {
      await persistCloudSession(final, exs);
    } catch (error) {
      setProgressionLoading(false);
      toast.error("La séance n'a pas été enregistrée dans Supabase", { description: error instanceof Error ? error.message : "Réessaie avant de quitter la séance." });
      return;
    }
    setSessions((p) => [final, ...p.filter((item) => item.id !== final.id)]);
    setActive(null);
    const completedExerciseIds = final.exercises.filter((exercise) => exercise.sets.some((set) => set.done)).map((exercise) => exercise.exerciseId);
    if (completedExerciseIds.length) {
      try {
        const result = await generateProgression({ data: { sessionId: final.id, exerciseIds: [...new Set(completedExerciseIds)] } });
        if (result.targets?.length) setTargets((current) => ({ ...current, ...Object.fromEntries(result.targets.map((target: ProgressionTarget) => [target.exerciseId, target])) }));
        const preview = (result.targets ?? []).slice(0, 4).map((target: ProgressionTarget) => String(target.targetSets) + " × " + String(target.targetReps) + (target.targetWeight > 0 ? " @ " + String(target.targetWeight) + " kg" : "")).join(" · ");
        toast.success("Séance terminée — " + String(final.durationMin) + " min", { description: preview ? "Cible IA : " + preview : "Séance enregistrée et progression analysée." });
      } catch (error) {
        console.warn("[sport] progression IA indisponible", error);
        toast.success("Séance terminée — " + String(final.durationMin) + " min", { description: "Séance enregistrée. L'analyse IA sera réessayée à la prochaine séance." });
      }
    } else {
      toast.success("Séance terminée — " + String(final.durationMin) + " min", { description: "Séance enregistrée dans l'historique." });
    }
    setProgressionLoading(false);
  };
  const cancelSession = () => { if (!confirm("Abandonner la séance en cours ?")) return; setActive(null); };
  const last7 = lastNDays(7); const sessionsThisWeek = sessions.filter((s) => last7.includes(s.date)); const daysActive = new Set(sessionsThisWeek.map((s) => s.date)).size;
  return <div>
    <PageHeader title="Sport" subtitle="Tes exercices, tes programmes, tes séances — à ton image." />{!cloudHistoryReady && <div className="text-[11px] text-amber-600 dark:text-amber-300 mb-2">Synchronisation de l’historique Sport…</div>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3"><StatCard label="Séances des 7 derniers jours" value={sessionsThisWeek.length} unit={sessionsThisWeek.length > 1 ? "séances" : "séance"} icon={<Dumbbell className="size-4" />} /><StatCard label="Jours actifs (sur 7)" value={`${daysActive} / 7`} icon={<CalIcon className="size-4" />} /></div>
    {active ? <ActiveSession active={active} setActive={setActive} exs={exs} sessions={sessions} targets={targets} onFinish={finishSession} onCancel={cancelSession} /> : <div className="rounded-2xl glass-card p-4 sm:p-5 mb-3"><div className="flex items-center justify-between mb-3 gap-2 flex-wrap"><h2 className="font-display text-base sm:text-lg font-semibold flex items-center gap-2"><CalIcon className="size-4 text-muted-foreground" /> Aujourd'hui ({DAYS_LABELS[todayDow]})</h2><Button size="sm" variant="secondary" onClick={() => startSession()} className="rounded-lg"><Play className="size-3 mr-1" />Séance libre</Button></div>{todayPrograms.length === 0 ? <div className="text-sm text-muted-foreground">Aucun programme prévu aujourd'hui. Crée-en un dans l'onglet Programmes.</div> : <div className="grid sm:grid-cols-2 gap-2">{todayPrograms.map((p) => <div key={p.id} className="rounded-xl glass-thin p-3 flex items-center gap-3"><div className="text-2xl">{p.emoji}</div><div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div><div className="text-xs text-muted-foreground">{p.items.length} exercice{p.items.length === 1 ? "" : "s"}</div></div><Button size="sm" onClick={() => startSession(p)} className="rounded-lg"><Play className="size-3 mr-1" />Démarrer</Button></div>)}</div>}</div>}
    <Tabs value={tab} onValueChange={setTab} className="w-full"><div className="overflow-x-auto -mx-1 px-1 mb-2 scrollbar-hide"><TabsList className="inline-flex w-max min-w-full"><TabsTrigger value="programs" className="text-xs sm:text-sm">Programmes</TabsTrigger><TabsTrigger value="archived" className="text-xs sm:text-sm"><Archive className="size-3 mr-1" />Archivés</TabsTrigger><TabsTrigger value="exercises" className="text-xs sm:text-sm">Exercices</TabsTrigger><TabsTrigger value="overload" className="text-xs sm:text-sm"><TrendingUp className="size-3 mr-1" />Surcharge</TabsTrigger><TabsTrigger value="history" className="text-xs sm:text-sm"><History className="size-3 mr-1" />Historique</TabsTrigger></TabsList></div><TabsContent value="programs"><ProgramsTab progs={progs} setProgs={setProgs} exs={exs} onOpenExercise={openOverload} showArchived={false} /></TabsContent><TabsContent value="archived"><ProgramsTab progs={progs} setProgs={setProgs} exs={exs} onOpenExercise={openOverload} showArchived /></TabsContent><TabsContent value="exercises"><ExercisesTab exs={exs} setExs={setExs} /></TabsContent><TabsContent value="overload"><OverloadTab exs={exs} setExs={setExs} progs={progs} setProgs={setProgs} sessions={sessions} targets={targets} focusExerciseId={focusEx} /></TabsContent><TabsContent value="history"><HistoryTab sessions={sessions} exs={exs} onDelete={async (id) => { const { data, error } = await supabase.rpc("sport_delete_workout", { p_id: id }); if (error || data !== true) { toast.error("Suppression de la séance impossible."); return; } setSessions((p) => p.filter((s) => s.id !== id)); toast.success("Séance supprimée de l’historique."); }} /></TabsContent></Tabs>
  </div>;
}

function ActiveSession({ active, setActive, exs, sessions, targets, onFinish, onCancel }: { active: WorkoutSession; setActive: (v: WorkoutSession | null) => void; exs: Exercise[]; sessions: WorkoutSession[]; targets: Record<string, ProgressionTarget>; onFinish: () => void; onCancel: () => void }) {
  const updateSet = (exIdx: number, setIdx: number, patch: Partial<SessionSet>) => setActive({ ...active, exercises: active.exercises.map((e, i) => i !== exIdx ? e : { ...e, sets: e.sets.map((s, j) => j !== setIdx ? s : { ...s, ...patch }) }) });
  const addSet = (exIdx: number) => { const last = active.exercises[exIdx].sets.slice(-1)[0]; setActive({ ...active, exercises: active.exercises.map((e, i) => i !== exIdx ? e : { ...e, sets: [...e.sets, { reps: last?.reps ?? 8, weight: last?.weight ?? 0, done: false }] }) }); };
  const addExercise = (id: string) => {
    const previous = sessions
      .filter((session) => session.exercises.some((exercise) => exercise.exerciseId === id))
      .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt)[0];
    const previousExercise = previous?.exercises.find((exercise) => exercise.exerciseId === id);
    const previousSets = previousExercise?.sets.filter((set) => set.done);
    const sourceSets = previousSets?.length ? previousSets : [{ reps: 8, weight: 0, done: false }];
    setActive({
      ...active,
      exercises: [...active.exercises, {
        exerciseId: id,
        sets: sourceSets.map((set) => ({ reps: set.reps, weight: set.weight, done: false })),
      }],
    });
  };
  const removeExercise = (idx: number) => setActive({ ...active, exercises: active.exercises.filter((_, i) => i !== idx) });
  return <div className="rounded-2xl glass-card p-5 mb-4"><div className="flex items-center justify-between mb-3 flex-wrap gap-2"><div><div className="text-xs text-primary font-medium uppercase tracking-wider">Séance en cours</div><h2 className="font-display text-xl font-semibold">{active.name}</h2></div><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={onCancel}>Annuler</Button><Button onClick={onFinish} className="rounded-xl"><Square className="size-3 mr-1" />Terminer</Button></div></div><div className="space-y-3">{active.exercises.map((e, exIdx) => { const meta = exs.find((x) => x.id === e.exerciseId); return <div key={exIdx} className="rounded-xl glass-thin p-3"><div className="flex items-center justify-between mb-2"><div className="font-medium">{meta?.name ?? "Exercice"} <span className="text-xs text-muted-foreground">{meta?.muscle}</span>{targets[e.exerciseId] && <span className="ml-2 text-[11px] text-primary">(cible : {targets[e.exerciseId].targetSets} × {targets[e.exerciseId].targetReps}{targets[e.exerciseId].targetWeight > 0 ? ` @ ${targets[e.exerciseId].targetWeight} kg` : ""})</span>}</div><button onClick={() => removeExercise(exIdx)} aria-label="Retirer cet exercice" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></div><div className="space-y-1.5">{e.sets.map((s, j) => <div key={j} className="flex items-center gap-2"><span className="text-xs text-muted-foreground w-6">{j + 1}.</span><Input type="number" value={s.weight || ""} onChange={(ev) => updateSet(exIdx, j, { weight: +ev.target.value || 0 })} placeholder="kg" className="h-8 w-20 text-sm" /><span className="text-xs text-muted-foreground">×</span><Input type="number" value={s.reps || ""} onChange={(ev) => updateSet(exIdx, j, { reps: Math.max(1, +ev.target.value || 1) })} placeholder="reps" className="h-8 w-20 text-sm" /><button onClick={() => updateSet(exIdx, j, { done: !s.done })} className={`size-7 rounded-md grid place-items-center ${s.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><Check className="size-3.5" /></button></div>)}<Button variant="ghost" size="sm" onClick={() => addSet(exIdx)} className="h-7 text-xs"><Plus className="size-3 mr-1" />Série</Button></div></div>; })}<SportExercisePicker exercises={exs} onChange={addExercise} /></div></div>;
}

const ExercisesTab = memo(function ExercisesTab({ exs, setExs }: { exs: Exercise[]; setExs: (v: Exercise[] | ((p: Exercise[]) => Exercise[])) => void }) {
  const [editing, setEditing] = useState<Exercise | null>(null); const [open, setOpen] = useState(false);
  const save = (e: Exercise) => { setExs((p) => { const i = p.findIndex((x) => x.id === e.id); if (i >= 0) { const n = [...p]; n[i] = e; return n; } return [...p, e]; }); setEditing(null); setOpen(false); };
  return <div className="space-y-3"><Button onClick={() => { setEditing({ id: crypto.randomUUID(), name: "", muscle: MUSCLES[0] }); setOpen(true); }} className="rounded-xl"><Plus className="size-4 mr-1" />Nouvel exercice</Button><Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>{editing && <ExerciseForm key={editing.id} ex={editing} onSave={save} onCancel={() => { setEditing(null); setOpen(false); }} />}</Dialog>{exs.length === 0 ? <div className="text-sm text-muted-foreground text-center py-8">Aucun exercice. Crée-en un pour commencer.</div> : <div className="grid sm:grid-cols-2 gap-2">{exs.map((e) => <div key={e.id} className="rounded-xl glass-thin p-3 flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-medium">{e.name}</div><div className="text-xs text-muted-foreground">{e.muscle}{e.equipment ? ` · ${e.equipment}` : ""}</div>{e.notes && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.notes}</div>}</div><div className="flex gap-1 shrink-0"><button onClick={() => { setEditing(e); setOpen(true); }} className="text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /></button><button onClick={() => setExs((p) => p.filter((x) => x.id !== e.id))} aria-label={`Supprimer l’exercice ${e.name}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></div></div>)}</div>}</div>;
});

function ExerciseForm({ ex, onSave, onCancel }: { ex: Exercise | null; onSave: (e: Exercise) => void; onCancel: () => void }) { const [e, setE] = useState<Exercise | null>(ex); if (!e) return null; const up = <K extends keyof Exercise>(k: K, v: Exercise[K]) => setE({ ...e, [k]: v }); return <DialogContent><DialogHeader><DialogTitle>{ex?.name ? "Modifier" : "Nouvel exercice"}</DialogTitle></DialogHeader><div className="space-y-3"><Input placeholder="Nom (ex: Développé couché)" value={e.name} onChange={(ev) => up("name", ev.target.value)} /><Select value={e.muscle} onValueChange={(v) => up("muscle", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MUSCLES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select><Input placeholder="Matériel (haltères, barre…)" value={e.equipment ?? ""} onChange={(ev) => up("equipment", ev.target.value)} /><Textarea placeholder="Notes perso (technique, ressenti…)" value={e.notes ?? ""} onChange={(ev) => up("notes", ev.target.value)} rows={3} /><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Annuler</Button><Button onClick={() => e.name && onSave(e)}>Enregistrer</Button></div></div></DialogContent>; }

const ProgramsTab = memo(function ProgramsTab({ progs, setProgs, exs, onOpenExercise, showArchived }: { progs: Program[]; setProgs: (v: Program[] | ((p: Program[]) => Program[])) => void; exs: Exercise[]; onOpenExercise: (exerciseId: string) => void; showArchived: boolean }) {
  const [editing, setEditing] = useState<Program | null>(null); const [open, setOpen] = useState(false); const [openedId, setOpenedId] = useState<string | null>(null);
  const save = (p: Program) => { setProgs((prev) => { const i = prev.findIndex((x) => x.id === p.id); if (i >= 0) { const n = [...prev]; n[i] = p; return n; } return [...prev, p]; }); setEditing(null); setOpen(false); };
  const visibleProgs = progs.filter((p) => Boolean(p.isArchived) === showArchived);
  const opened = visibleProgs.find((p) => p.id === openedId) ?? null;
  if (opened) { const groups = new Map<string, { item: ProgramItem; ex: Exercise }[]>(); opened.items.forEach((item) => { const ex = exs.find((x) => x.id === item.exerciseId); if (!ex) return; const arr = groups.get(ex.muscle) ?? []; arr.push({ item, ex }); groups.set(ex.muscle, arr); }); return <div className="space-y-3"><button onClick={() => setOpenedId(null)} className="text-sm text-muted-foreground hover:text-foreground">← Programmes</button><div className="rounded-2xl glass-card p-4"><div className="flex items-center gap-2 mb-1"><span className="text-2xl">{opened.emoji}</span><div><h2 className="font-display text-lg font-semibold">{opened.name}</h2><div className="text-xs text-muted-foreground">{opened.items.length} exercice{opened.items.length === 1 ? "" : "s"} · {opened.days.map((d) => DAYS_LABELS[d]).join(" · ") || "Aucun jour"}</div></div></div></div>{groups.size === 0 ? <div className="text-sm text-muted-foreground text-center py-8">Aucun exercice dans ce programme.</div> : [...groups.entries()].map(([muscle, list]) => <div key={muscle} className="space-y-1.5"><div className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">{muscle}</div>{list.map(({ item, ex }) => <button key={ex.id + item.exerciseId} onClick={() => onOpenExercise(ex.id)} className="w-full text-left rounded-xl glass-thin p-3 flex items-center justify-between gap-3 hover:bg-[rgb(var(--glass-tint)/0.08)]"><div className="min-w-0"><div className="font-medium truncate">{ex.name}</div><div className="text-xs text-muted-foreground">{item.sets} × {item.reps}{item.weight ? ` · ${item.weight} kg` : ""}{ex.equipment ? ` · ${ex.equipment}` : ""}</div></div><span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1"><TrendingUp className="size-3" />Surcharge →</span></button>)}</div>)}</div>; }
  return <div className="space-y-3"><Button onClick={() => { setEditing({ id: crypto.randomUUID(), name: "", emoji: "💪", days: [], items: [] }); setOpen(true); }} className="rounded-xl" disabled={exs.length === 0}><Plus className="size-4 mr-1" />Nouveau programme</Button><Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>{editing && <ProgramForm key={editing.id} prog={editing} exs={exs} onSave={save} onCancel={() => { setEditing(null); setOpen(false); }} />}</Dialog>{exs.length === 0 && <div className="text-xs text-muted-foreground">Crée d'abord des exercices.</div>}{progs.length === 0 ? <div className="text-sm text-muted-foreground text-center py-8">Aucun programme.</div> : <div className="grid sm:grid-cols-2 gap-2">{visibleProgs.map((p) => <div key={p.id} className="rounded-xl glass-thin p-3"><div className="flex items-start justify-between gap-2"><button onClick={() => setOpenedId(p.id)} className="flex items-center gap-2 min-w-0 text-left flex-1"><div className="text-2xl">{p.emoji}</div><div className="min-w-0"><div className="font-medium truncate">{p.name}</div><div className="text-xs text-muted-foreground">{p.days.map((d) => DAYS_LABELS[d]).join(" · ") || "Aucun jour"} · {p.items.length} ex.</div></div></button><div className="flex gap-1 shrink-0"><button onClick={() => { setEditing(p); setOpen(true); }} className="text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /></button><button onClick={() => setProgs((prev) => prev.map((x) => x.id === p.id ? { ...x, isArchived: !x.isArchived } : x))} aria-label={p.isArchived ? `Restaurer le programme ${p.name}` : `Archiver le programme ${p.name}`} className="text-muted-foreground hover:text-foreground">{p.isArchived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}</button><button onClick={() => setProgs((prev) => prev.filter((x) => x.id !== p.id))} aria-label={`Supprimer le programme ${p.name}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></div></div></div>)}</div>}</div>;
});

function ProgramForm({ prog, exs, onSave, onCancel }: { prog: Program | null; exs: Exercise[]; onSave: (p: Program) => void; onCancel: () => void }) { const [p, setP] = useState<Program | null>(prog); if (!p) return null; const up = <K extends keyof Program>(k: K, v: Program[K]) => setP({ ...p, [k]: v }); const toggleDay = (d: number) => up("days", p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d]); const addItem = (id: string) => up("items", [...p.items, { exerciseId: id, sets: 3, reps: 10 }]); const updateItem = (i: number, patch: Partial<ProgramItem>) => up("items", p.items.map((it, idx) => idx !== i ? it : { ...it, ...patch })); const removeItem = (i: number) => up("items", p.items.filter((_, idx) => idx !== i)); return <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{prog?.name ? "Modifier" : "Nouveau programme"}</DialogTitle></DialogHeader><div className="space-y-3 max-h-[70vh] overflow-y-auto"><div className="flex gap-2"><Input value={p.emoji} onChange={(e) => up("emoji", e.target.value)} className="w-16 text-center" maxLength={2} /><Input placeholder="Nom (Push, Pull, Legs…)" value={p.name} onChange={(e) => up("name", e.target.value)} className="flex-1" /></div><div><div className="text-xs text-muted-foreground mb-1">Jours de la semaine</div><div className="flex gap-1 flex-wrap">{DAYS_LABELS.map((d, i) => <button key={i} onClick={() => toggleDay(i)} className={`px-3 py-1.5 rounded-lg text-xs ${p.days.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{d}</button>)}</div></div><div><div className="text-xs text-muted-foreground mb-1">Exercices</div><div className="space-y-2">{p.items.map((it, i) => { const meta = exs.find((x) => x.id === it.exerciseId); return <div key={i} className="flex items-center gap-1.5 text-sm"><span className="flex-1 truncate">{meta?.name ?? "?"}</span><Input type="number" value={it.sets} onChange={(e) => updateItem(i, { sets: +e.target.value || 1 })} className="h-8 w-14" /><span className="text-xs text-muted-foreground">×</span><Input type="number" value={it.reps} onChange={(e) => updateItem(i, { reps: +e.target.value || 1 })} className="h-8 w-14" /><Input type="number" placeholder="kg" value={it.weight ?? ""} onChange={(e) => updateItem(i, { weight: +e.target.value || 0 })} className="h-8 w-16" /><button onClick={() => removeItem(i)} aria-label="Retirer cet exercice du programme" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></div>; })}<SportExercisePicker exercises={exs} onChange={addItem} /></div></div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Annuler</Button><Button onClick={() => p.name && onSave(p)}>Enregistrer</Button></div></div></DialogContent>; }

const HistoryTab = memo(function HistoryTab({ sessions, exs, onDelete }: { sessions: WorkoutSession[]; exs: Exercise[]; onDelete: (id: string) => void }) { const grouped = useMemo(() => { const map: Record<string, WorkoutSession[]> = {}; sessions.forEach((s) => { (map[s.date] ??= []).push(s); }); return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])); }, [sessions]); if (sessions.length === 0) return <div className="text-sm text-muted-foreground text-center py-8">Aucune séance terminée.</div>; return <div className="space-y-4">{grouped.map(([date, list]) => <div key={date}><div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div><div className="space-y-2">{list.map((s) => { const vol = s.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).reduce((b, x) => b + x.reps * x.weight, 0), 0); return <div key={s.id} className="rounded-xl glass-thin p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.durationMin ?? 0} min · {Math.round(vol)} kg volume · {s.exercises.length} exercices</div></div><button onClick={() => onDelete(s.id)} aria-label="Supprimer cette séance" className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="size-3.5" /></button></div><div className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{s.exercises.map((e) => { const m = exs.find((x) => x.id === e.exerciseId); const done = e.sets.filter((x) => x.done).length; return `${m?.name ?? "?"} (${done}/${e.sets.length})`; }).join(" · ")}</div></div>; })}</div></div>)}</div>; });

type OverloadRow = { id: string; date: string; weight: number; reps: number; sets: number; repSeries?: number[]; weightSeries?: number[]; note?: string; source: "session" | "manual" };
type OverloadStore = Record<string, OverloadRow[]>;

function deriveSessionRows(sessions: WorkoutSession[], exerciseId: string): OverloadRow[] {
  const rows: OverloadRow[] = [];
  for (const s of sessions) {
    const se = s.exercises.find((e) => e.exerciseId === exerciseId); if (!se) continue;
    const done = se.sets.filter((x) => x.done); if (!done.length) continue;
    const best = done.reduce((a, b) => (b.weight > a.weight ? b : a));
    rows.push({ id: `sess-${s.id}`, date: s.date, weight: best.weight, reps: best.reps, sets: done.length, repSeries: done.map((x) => x.reps), weightSeries: done.map((x) => x.weight), note: se.note, source: "session" });
  }
  return rows;
}

const OverloadTab = memo(function OverloadTab({ exs, setExs, progs, setProgs, sessions, targets: aiTargets, focusExerciseId }: { exs: Exercise[]; setExs: (v: Exercise[] | ((p: Exercise[]) => Exercise[])) => void; progs: Program[]; setProgs: (v: Program[] | ((p: Program[]) => Program[])) => void; sessions: WorkoutSession[]; targets: Record<string, ProgressionTarget>; focusExerciseId?: string | null }) {
  const [manualStore, setManualStore] = useLocalState<OverloadStore>("pace.sport.overload", {});
  const rowsByExercise = useMemo(() => { const map: Record<string, OverloadRow[]> = {}; exs.forEach((e) => { const sessionRows = deriveSessionRows(sessions, e.id); const manualRows = manualStore[e.id] ?? []; map[e.id] = [...sessionRows, ...manualRows].sort((a, b) => b.date.localeCompare(a.date) || (a.source === "manual" ? -1 : 1)); }); return map; }, [exs, sessions, manualStore]);
  const muscles = useMemo(() => Array.from(new Set(exs.map((e) => e.muscle))), [exs]); const [muscle, setMuscle] = useState(""); const currentMuscle = muscle || muscles[0] || ""; const muscleExs = useMemo(() => exs.filter((e) => e.muscle === currentMuscle), [exs, currentMuscle]);
  const targets = useMemo(() => { const map: Record<string, { sets: number; reps: number; weight: number }> = {}; exs.forEach((e) => { map[e.id] = { sets: e.defaultSets ?? 3, reps: e.defaultReps ?? 10, weight: e.defaultWeight ?? 0 }; }); progs.forEach((p) => p.items.forEach((it) => { map[it.exerciseId] = { sets: it.sets, reps: it.reps, weight: it.weight ?? map[it.exerciseId]?.weight ?? 0 }; })); return map; }, [exs, progs]);
  useEffect(() => { if (!focusExerciseId) return; const target = exs.find((e) => e.id === focusExerciseId); if (!target) return; setMuscle(target.muscle); const id = requestAnimationFrame(() => document.getElementById(`ov-${focusExerciseId}`)?.scrollIntoView({ block: "start", behavior: "smooth" })); return () => cancelAnimationFrame(id); }, [focusExerciseId, exs]);
  const syncExerciseFromRow = (exerciseId: string, r: OverloadRow) => { setExs((p) => p.map((e) => e.id === exerciseId ? { ...e, defaultWeight: r.weight, defaultReps: r.reps, defaultSets: r.sets } : e)); setProgs((p) => p.map((prog) => ({ ...prog, items: prog.items.map((it) => it.exerciseId === exerciseId ? { ...it, weight: r.weight, reps: r.reps, sets: r.sets } : it) }))); };
  const addRow = (exerciseId: string) => { const tgt = targets[exerciseId] ?? { sets: 3, reps: 10, weight: 0 }; const prev = (rowsByExercise[exerciseId] ?? [])[0]; const r: OverloadRow = { id: crypto.randomUUID(), date: todayKey(), weight: prev?.weight ?? tgt.weight, reps: tgt.reps, sets: tgt.sets, repSeries: Array.from({ length: tgt.sets }, () => tgt.reps), weightSeries: Array.from({ length: tgt.sets }, () => prev?.weight ?? tgt.weight), source: "manual" }; setManualStore((p) => ({ ...p, [exerciseId]: [r, ...(p[exerciseId] ?? [])] })); syncExerciseFromRow(exerciseId, r); };
  const updateRow = (exerciseId: string, id: string, patch: Partial<OverloadRow>) => { const current = (manualStore[exerciseId] ?? []).find((r) => r.id === id); if (!current) return; const updatedRow = { ...current, ...patch }; setManualStore((p) => ({ ...p, [exerciseId]: (p[exerciseId] ?? []).map((r) => r.id === id ? updatedRow : r) })); const rows = rowsByExercise[exerciseId] ?? []; const mostRecentDate = rows.reduce((max, r) => r.date > max ? r.date : max, ""); if (updatedRow.date >= mostRecentDate) syncExerciseFromRow(exerciseId, updatedRow); };
  const parseSeries = (value: string) => value.split("/").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v >= 0);
  const removeRow = (exerciseId: string, id: string) => setManualStore((p) => ({ ...p, [exerciseId]: (p[exerciseId] ?? []).filter((r) => r.id !== id) }));
  const guardSession = (row: OverloadRow) => { if (row.source === "session") { toast.info("Cette ligne vient d'une séance réelle — modifie-la dans l'onglet Historique."); return true; } return false; };
  if (!exs.length) return <div className="text-sm text-muted-foreground text-center py-8">Crée d'abord un exercice pour suivre ta surcharge progressive.</div>;
  return <div className="space-y-4"><div><div className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">Groupe musculaire</div><div className="flex gap-1.5 flex-wrap">{muscles.map((m) => <button key={m} onClick={() => setMuscle(m)} className={`px-3 py-1.5 rounded-lg text-xs ${currentMuscle === m ? "glass-thin text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>{m}</button>)}</div></div>{!muscleExs.length ? <div className="text-sm text-muted-foreground text-center py-8">Aucun exercice dans ce groupe.</div> : <div className="space-y-4">{muscleExs.map((ex) => { const rows = rowsByExercise[ex.id] ?? []; const tgt = targets[ex.id]; const lastW = rows[0]?.weight ?? 0; const prevW = rows[1]?.weight ?? 0; const delta = lastW - prevW; return <div key={ex.id} id={`ov-${ex.id}`} className="rounded-2xl glass-card overflow-hidden scroll-mt-24"><div className="flex items-center justify-between gap-2 p-3 border-b border-border/50 flex-wrap"><div className="min-w-0"><div className="font-medium truncate">{ex.name}</div>{ex.equipment && <div className="text-[11px] text-muted-foreground">{ex.equipment}</div>}</div><div className="flex items-center gap-1.5 flex-wrap text-[11px]">{aiTargets[ex.id] ? <span className="px-2 py-0.5 rounded-md glass-thin text-primary">(cible : <b>{aiTargets[ex.id].targetSets} × {aiTargets[ex.id].targetReps}{aiTargets[ex.id].targetWeight > 0 ? " @ " + aiTargets[ex.id].targetWeight + " kg" : ""}</b>)</span> : tgt && <span className="px-2 py-0.5 rounded-md glass-thin">Base <b>{tgt.sets} × {tgt.reps}</b></span>}{rows.length >= 2 && <span className={`px-2 py-0.5 rounded-md ${delta > 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : delta < 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted"}`}>{delta > 0 ? "↑" : delta < 0 ? "↓" : "="} {Math.abs(delta)} kg</span>}<Button size="sm" variant="secondary" onClick={() => addRow(ex.id)} className="rounded-lg h-7 text-xs"><Plus className="size-3 mr-0.5" />Ligne manuelle</Button></div></div>{!rows.length ? <div className="text-xs text-muted-foreground text-center py-4">Aucune entrée. Termine une séance avec cet exercice, ou ajoute une ligne manuelle.</div> : <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="grid grid-cols-[110px_1fr_1fr_1fr_1fr_36px] gap-px bg-border text-[11px] uppercase tracking-wider text-muted-foreground"><div className="bg-card px-2 py-1.5">Date</div><div className="bg-card px-2 py-1.5 text-center">Reps / série</div><div className="bg-card px-2 py-1.5 text-center">Kg / série</div><div className="bg-card px-2 py-1.5 text-center">Séries</div><div className="bg-card px-2 py-1.5">Note</div><div className="bg-card px-2 py-1.5" /></div>{rows.map((r) => { const locked = r.source === "session"; const repsSeries = r.repSeries?.length ? r.repSeries : [r.reps]; const weightSeries = r.weightSeries?.length ? r.weightSeries : [r.weight]; const repsText = repsSeries.join(" / "); const weightText = weightSeries.join(" / "); return <div key={r.id} className="grid grid-cols-[110px_1fr_1fr_1fr_1fr_36px] gap-px bg-border text-sm"><div className="bg-card px-1 py-1 flex items-center gap-1"><Input type="date" value={r.date} disabled={locked} onChange={(e) => updateRow(ex.id, r.id, { date: e.target.value })} className="h-8 text-xs" />{locked && <span title="Issue d'une séance réelle" className="text-[10px] text-primary shrink-0">●</span>}</div><div className="bg-card px-1 py-1"><Input value={repsText} disabled={locked} onChange={(e) => { const series = parseSeries(e.target.value); updateRow(ex.id, r.id, { repSeries: series, reps: series[0] ?? 0, sets: series.length }); }} placeholder="9 / 7 / 7" className="h-8 text-center text-xs" /></div><div className="bg-card px-1 py-1"><Input value={weightText} disabled={locked} onChange={(e) => { const series = parseSeries(e.target.value); updateRow(ex.id, r.id, { weightSeries: series, weight: series[0] ?? 0 }); }} placeholder="40 / 42 / 42" className="h-8 text-center text-xs" /></div><div className="bg-card px-1 py-1"><Input type="number" value={r.sets || ""} disabled={locked} onChange={(e) => updateRow(ex.id, r.id, { sets: +e.target.value || 0 })} className="h-8 text-center" /></div><div className="bg-card px-1 py-1"><Input value={r.note ?? ""} disabled={locked} onChange={(e) => updateRow(ex.id, r.id, { note: e.target.value })} placeholder="Ressenti…" className="h-8 text-xs" /></div><button onClick={() => locked ? guardSession(r) : removeRow(ex.id, r.id)} aria-label="Supprimer cette ligne de surcharge" className="bg-card grid place-items-center text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></div>; })}</div></div>}</div>; })}</div>}</div>;
});
