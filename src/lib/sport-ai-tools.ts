import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<any>;
type LogAction = (actionType: string, label: string, payload: unknown, status: "executed" | "failed") => Promise<void>;
type Output = { ok: boolean; message: string; id?: string; data?: unknown };

function logged(name: string, execute: (input: any, options: ToolExecutionOptions<unknown>) => Promise<Output>) {
  return async (input: any, options: ToolExecutionOptions<unknown>) => {
    const startedAt = Date.now();
    console.info("[ai-tool] appelé", { name, toolCallId: options.toolCallId });
    try {
      const output = await execute(input, options);
      console.info("[ai-tool] terminé", { name, toolCallId: options.toolCallId, ms: Date.now() - startedAt, ok: output.ok });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inattendue";
      console.error("[ai-tool] échec inattendu", { name, toolCallId: options.toolCallId, ms: Date.now() - startedAt, error: message });
      return { ok: false, message: `Action interrompue par une erreur inattendue : ${message}` };
    }
  };
}

function uuid() { return crypto.randomUUID(); }

export function canonicalSportTools(client: Client, userId: string, permissionsEnabled: boolean, logAction: LogAction) {
  const guard = (name: string, execute: (input: any, options: ToolExecutionOptions<unknown>) => Promise<Output>) =>
    logged(name, async (input, options) => permissionsEnabled ? execute(input, options) : { ok: false, message: "Permission Sport désactivée." });

  const exerciseSchema = z.object({
    id: z.string().uuid().optional(), name: z.string().min(1), muscle: z.string().min(1), equipment: z.string().optional(), notes: z.string().optional(),
    defaultSets: z.number().int().positive().optional(), defaultReps: z.number().int().positive().optional(), defaultWeight: z.number().nonnegative().optional(), restSec: z.number().int().nonnegative().optional(),
  });

  const createExercise = tool({ description: "Créer un exercice Sport dans la base normalisée Pace.", inputSchema: exerciseSchema,
    execute: guard("create_exercise", async (input) => {
      const id = input.id ?? uuid();
      const { data: existing } = await client.from("sport_exercises").select("id,name").eq("user_id", userId).ilike("name", input.name.trim()).maybeSingle();
      if (existing) return { ok: true, id: existing.id, message: `Exercice « ${existing.name} » déjà présent dans Sport.` };
      const { error } = await client.from("sport_exercises").insert({ id, user_id: userId, name: input.name.trim(), muscle: input.muscle.trim(), equipment: input.equipment ?? null, notes: input.notes ?? null, default_sets: input.defaultSets ?? null, default_reps: input.defaultReps ?? null, default_weight: input.defaultWeight ?? null, rest_sec: input.restSec ?? null });
      if (error) { await logAction("create_exercise", `Échec création exercice ${input.name}`, input, "failed"); return { ok: false, message: "Création de l’exercice impossible." }; }
      await logAction("create_exercise", `Exercice ${input.name} créé`, { ...input, id }, "executed");
      return { ok: true, id, message: `Exercice « ${input.name} » créé dans Sport.` };
    }) });

  const updateExercise = tool({ description: "Modifier un exercice Sport existant appartenant à l'utilisateur.", inputSchema: exerciseSchema.extend({ id: z.string().uuid() }),
    execute: guard("update_exercise", async (input) => {
      const { data, error } = await client.rpc("sport_update_exercise", { p_id: input.id, p_name: input.name, p_muscle: input.muscle, p_equipment: input.equipment ?? null, p_notes: input.notes ?? null, p_default_sets: input.defaultSets ?? null, p_default_reps: input.defaultReps ?? null, p_default_weight: input.defaultWeight ?? null, p_rest_sec: input.restSec ?? null });
      if (error || data !== true) { await logAction("update_exercise", "Échec modification exercice", input, "failed"); return { ok: false, message: "Exercice introuvable ou modification refusée." }; }
      await logAction("update_exercise", `Exercice ${input.name} modifié`, input, "executed");
      return { ok: true, id: input.id, message: `Exercice « ${input.name} » modifié.` };
    }) });

  const deleteExercise = tool({ description: "Supprimer un exercice Sport existant. Refuser si la base empêche la suppression par des dépendances.", inputSchema: z.object({ id: z.string().uuid() }),
    execute: guard("delete_exercise", async (input) => {
      const { data, error } = await client.rpc("sport_delete_exercise", { p_id: input.id });
      if (error || data !== true) { await logAction("delete_exercise", "Échec suppression exercice", input, "failed"); return { ok: false, message: "Exercice introuvable ou suppression refusée." }; }
      await logAction("delete_exercise", "Exercice supprimé", input, "executed");
      return { ok: true, id: input.id, message: "Exercice supprimé de Sport." };
    }) });

  const createProgram = tool({ description: "Créer un programme Sport avec ses exercices et objectifs.", inputSchema: z.object({ id: z.string().uuid().optional(), name: z.string().min(1), emoji: z.string().min(1).max(8).optional(), days: z.array(z.number().int().min(0).max(6)).default([]), items: z.array(z.object({ exerciseId: z.string().uuid(), sets: z.number().int().positive(), reps: z.number().int().positive(), weight: z.number().nonnegative().optional(), restSec: z.number().int().nonnegative().optional(), position: z.number().int().nonnegative().optional() })).default([]) }),
    execute: guard("create_program", async (input) => {
      const id = input.id ?? uuid();
      const { data: existing } = await client.from("sport_programs").select("id,name").eq("user_id", userId).ilike("name", input.name.trim()).maybeSingle();
      if (existing) return { ok: true, id: existing.id, message: `Programme « ${existing.name} » déjà présent.` };
      const { error } = await client.from("sport_programs").insert({ id, user_id: userId, name: input.name.trim(), emoji: input.emoji ?? "🏋️", days: input.days });
      if (error) { await logAction("create_program", "Échec création programme", input, "failed"); return { ok: false, message: "Création du programme impossible." }; }
      if (input.items.length) {
        const { error: itemError } = await client.from("sport_program_items").insert(input.items.map((item: any, index: number) => ({ program_id: id, exercise_id: item.exerciseId, position: item.position ?? index, sets: item.sets, reps: item.reps, weight: item.weight ?? null, rest_sec: item.restSec ?? null })));
        if (itemError) { await client.from("sport_programs").delete().eq("id", id).eq("user_id", userId); await logAction("create_program", "Échec ajout exercices au programme", input, "failed"); return { ok: false, message: "Programme créé mais ses exercices n’ont pas pu être enregistrés; opération annulée." }; }
      }
      await logAction("create_program", `Programme ${input.name} créé`, { ...input, id }, "executed");
      return { ok: true, id, message: `Programme « ${input.name} » créé dans Sport.` };
    }) });

  const updateProgram = tool({ description: "Modifier le nom, l'emoji ou les jours d'un programme Sport.", inputSchema: z.object({ id: z.string().uuid(), name: z.string().min(1).optional(), emoji: z.string().min(1).max(8).optional(), days: z.array(z.number().int().min(0).max(6)).optional() }),
    execute: guard("update_program", async (input) => {
      const { data, error } = await client.rpc("sport_update_program", { p_id: input.id, p_name: input.name ?? null, p_emoji: input.emoji ?? null, p_days: input.days ?? null });
      if (error || data !== true) { await logAction("update_program", "Échec modification programme", input, "failed"); return { ok: false, message: "Programme introuvable ou modification refusée." }; }
      await logAction("update_program", "Programme modifié", input, "executed"); return { ok: true, id: input.id, message: "Programme Sport modifié." };
    }) });

  const deleteProgram = tool({ description: "Supprimer un programme Sport appartenant à l'utilisateur.", inputSchema: z.object({ id: z.string().uuid() }),
    execute: guard("delete_program", async (input) => {
      const { data, error } = await client.rpc("sport_delete_program", { p_id: input.id });
      if (error || data !== true) { await logAction("delete_program", "Échec suppression programme", input, "failed"); return { ok: false, message: "Programme introuvable ou suppression refusée." }; }
      await logAction("delete_program", "Programme supprimé", input, "executed"); return { ok: true, id: input.id, message: "Programme supprimé de Sport." };
    }) });

  const programItemSchema = z.object({ operation: z.enum(["add", "remove"]), programId: z.string().uuid(), exerciseId: z.string().uuid(), sets: z.number().int().positive().optional(), reps: z.number().int().positive().optional(), weight: z.number().nonnegative().optional(), restSec: z.number().int().nonnegative().optional(), position: z.number().int().nonnegative().optional() });
  const programItem = tool({ description: "Ajouter un exercice à un programme Sport, ou le retirer avec operation=remove.", inputSchema: programItemSchema,
    execute: guard("program_item", async (input) => {
      if (input.operation === "remove") {
        const { error } = await client.from("sport_program_items").delete().eq("program_id", input.programId).eq("exercise_id", input.exerciseId);
        if (error) { await logAction("remove_exercise_from_program", "Échec retrait exercice", input, "failed"); return { ok: false, message: "Retrait de l’exercice impossible." }; }
        await logAction("remove_exercise_from_program", "Exercice retiré du programme", input, "executed"); return { ok: true, message: "Exercice retiré du programme." };
      }
      const { data: program } = await client.from("sport_programs").select("id").eq("id", input.programId).eq("user_id", userId).maybeSingle();
      const { data: exercise } = await client.from("sport_exercises").select("id").eq("id", input.exerciseId).eq("user_id", userId).maybeSingle();
      if (!program || !exercise) return { ok: false, message: "Programme ou exercice introuvable." };
      const { data: existing } = await client.from("sport_program_items").select("id").eq("program_id", input.programId).eq("exercise_id", input.exerciseId).maybeSingle();
      if (existing) return { ok: true, id: existing.id, message: "Exercice déjà présent dans le programme." };
      const { data: item, error } = await client.from("sport_program_items").insert({ program_id: input.programId, exercise_id: input.exerciseId, position: input.position ?? 0, sets: input.sets ?? 3, reps: input.reps ?? 8, weight: input.weight ?? null, rest_sec: input.restSec ?? null }).select("id").single();
      if (error || !item) { await logAction("add_exercise_to_program", "Échec ajout exercice", input, "failed"); return { ok: false, message: "Ajout de l’exercice au programme impossible." }; }
      await logAction("add_exercise_to_program", "Exercice ajouté au programme", { ...input, id: item.id }, "executed"); return { ok: true, id: item.id, message: "Exercice ajouté au programme." };
    }) });

  const addExerciseToProgram = tool({ description: "Ajouter un exercice à un programme Sport.", inputSchema: programItemSchema.pick({ programId: true, exerciseId: true, sets: true, reps: true, weight: true, restSec: true, position: true }),
    execute: guard("add_exercise_to_program", async (input) => programItem.execute!({ operation: "add", ...input }, {} as ToolExecutionOptions<unknown>)) });

  const removeExerciseFromProgram = tool({ description: "Retirer un exercice d'un programme Sport.", inputSchema: z.object({ programId: z.string().uuid(), exerciseId: z.string().uuid() }),
    execute: guard("remove_exercise_from_program", async (input) => programItem.execute!({ operation: "remove", ...input }, {} as ToolExecutionOptions<unknown>)) });

  const startWorkout = tool({ description: "Démarrer et persister une séance Sport.", inputSchema: z.object({ id: z.string().uuid().optional(), programId: z.string().uuid().optional(), name: z.string().min(1), workoutDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(), startedAt: z.string().datetime().optional(), notes: z.string().optional() }),
    execute: guard("start_workout", async (input) => {
      const id = input.id ?? uuid();
      const { error } = await client.from("sport_workout_sessions").insert({ id, user_id: userId, program_id: input.programId ?? null, name: input.name.trim(), workout_date: input.workoutDate ?? new Date().toISOString().slice(0, 10), started_at: input.startedAt ?? new Date().toISOString(), notes: input.notes ?? null });
      if (error) { await logAction("start_workout", "Échec démarrage séance", input, "failed"); return { ok: false, message: "Démarrage de la séance impossible." }; }
      await logAction("start_workout", `Séance ${input.name} démarrée`, { ...input, id }, "executed"); return { ok: true, id, message: `Séance « ${input.name} » démarrée.` };
    }) });

  const addWorkoutExercise = tool({ description: "Ajouter un exercice à une séance Sport persistée.", inputSchema: z.object({ sessionId: z.string().uuid(), exerciseId: z.string().uuid(), note: z.string().optional(), position: z.number().int().nonnegative().optional() }),
    execute: guard("add_workout_exercise", async (input) => {
      const { data: session } = await client.from("sport_workout_sessions").select("id").eq("id", input.sessionId).eq("user_id", userId).maybeSingle();
      const { data: exercise } = await client.from("sport_exercises").select("id").eq("id", input.exerciseId).eq("user_id", userId).maybeSingle();
      if (!session || !exercise) return { ok: false, message: "Séance ou exercice introuvable." };
      const { data: existing } = await client.from("sport_workout_exercises").select("id").eq("session_id", input.sessionId).eq("exercise_id", input.exerciseId).maybeSingle();
      if (existing) return { ok: true, id: existing.id, message: "Exercice déjà présent dans la séance." };
      const { data, error } = await client.from("sport_workout_exercises").insert({ session_id: input.sessionId, exercise_id: input.exerciseId, position: input.position ?? 0, note: input.note ?? null }).select("id").single();
      if (error || !data) { await logAction("add_workout_exercise", "Échec ajout exercice séance", input, "failed"); return { ok: false, message: "Ajout de l’exercice à la séance impossible." }; }
      await logAction("add_workout_exercise", "Exercice ajouté à la séance", { ...input, id: data.id }, "executed"); return { ok: true, id: data.id, message: "Exercice ajouté à la séance." };
    }) });

  const addWorkoutSet = tool({ description: "Ajouter ou modifier une série dans une séance Sport.", inputSchema: z.object({ workoutExerciseId: z.string().uuid(), setNumber: z.number().int().positive(), weight: z.number().nonnegative(), reps: z.number().int().positive(), done: z.boolean().optional() }),
    execute: guard("add_workout_set", async (input) => {
      const { data: workoutExercise } = await client.from("sport_workout_exercises").select("id,session_id").eq("id", input.workoutExerciseId).maybeSingle();
      if (!workoutExercise) return { ok: false, message: "Exercice de séance introuvable." };
      const { data: session } = await client.from("sport_workout_sessions").select("id").eq("id", workoutExercise.session_id).eq("user_id", userId).maybeSingle();
      if (!session) return { ok: false, message: "Séance introuvable ou non autorisée." };
      const { data: existing } = await client.from("sport_workout_sets").select("id").eq("workout_exercise_id", input.workoutExerciseId).eq("set_number", input.setNumber).maybeSingle();
      if (existing) {
        const { error } = await client.from("sport_workout_sets").update({ weight: input.weight, reps: input.reps, done: input.done ?? true }).eq("id", existing.id);
        if (error) return { ok: false, message: "Mise à jour de la série impossible." };
        await logAction("add_workout_set", "Série mise à jour", input, "executed"); return { ok: true, id: existing.id, message: "Série mise à jour." };
      }
      const { data, error } = await client.from("sport_workout_sets").insert({ workout_exercise_id: input.workoutExerciseId, set_number: input.setNumber, weight: input.weight, reps: input.reps, done: input.done ?? true }).select("id").single();
      if (error || !data) { await logAction("add_workout_set", "Échec ajout série", input, "failed"); return { ok: false, message: "Ajout de la série impossible." }; }
      await logAction("add_workout_set", "Série ajoutée", { ...input, id: data.id }, "executed"); return { ok: true, id: data.id, message: "Série ajoutée." };
    }) });

  const updateWorkoutSet = tool({ description: "Modifier une série existante dans une séance Sport.", inputSchema: z.object({ id: z.string().uuid(), weight: z.number().nonnegative().optional(), reps: z.number().int().positive().optional(), done: z.boolean().optional() }),
    execute: guard("update_workout_set", async (input) => {
      const { data: existing } = await client.from("sport_workout_sets").select("id,workout_exercise_id").eq("id", input.id).maybeSingle();
      if (!existing) return { ok: false, message: "Série introuvable." };
      const { data: workoutExercise } = await client.from("sport_workout_exercises").select("id,session_id").eq("id", existing.workout_exercise_id).maybeSingle();
      if (!workoutExercise) return { ok: false, message: "Exercice de séance introuvable." };
      const { data: session } = await client.from("sport_workout_sessions").select("id").eq("id", workoutExercise.session_id).eq("user_id", userId).maybeSingle();
      if (!session) return { ok: false, message: "Séance introuvable ou non autorisée." };
      const { error } = await client.from("sport_workout_sets").update({ ...(input.weight !== undefined ? { weight: input.weight } : {}), ...(input.reps !== undefined ? { reps: input.reps } : {}), ...(input.done !== undefined ? { done: input.done } : {}) }).eq("id", input.id);
      if (error) { await logAction("update_workout_set", "Échec modification série", input, "failed"); return { ok: false, message: "Modification de la série impossible." }; }
      await logAction("update_workout_set", "Série modifiée", input, "executed"); return { ok: true, id: input.id, message: "Série modifiée." };
    }) });

  const finishWorkout = tool({ description: "Terminer une séance Sport et calculer sa durée.", inputSchema: z.object({ id: z.string().uuid(), endedAt: z.string().datetime().optional(), durationMin: z.number().int().nonnegative().optional(), notes: z.string().optional() }),
    execute: guard("finish_workout", async (input) => {
      const { data, error } = await client.rpc("sport_finish_workout", { p_id: input.id, p_ended_at: input.endedAt ?? new Date().toISOString(), p_duration_min: input.durationMin ?? null, p_notes: input.notes ?? null });
      if (error || data !== true) { await logAction("finish_workout", "Échec fin de séance", input, "failed"); return { ok: false, message: "Séance introuvable ou fin de séance refusée." }; }
      await logAction("finish_workout", "Séance terminée", input, "executed"); return { ok: true, id: input.id, message: "Séance Sport terminée." };
    }) });

  const getHistory = tool({ description: "Lire l'historique des séances Sport de l'utilisateur, avec exercices et séries.", inputSchema: z.object({ limit: z.number().int().positive().max(100).default(20), fromDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(), toDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional() }),
    execute: guard("get_workout_history", async (input) => {
      let query = client.from("sport_workout_sessions").select("id,program_id,name,workout_date,started_at,ended_at,duration_min,notes,sport_workout_exercises(id,exercise_id,position,note,sport_workout_sets(id,set_number,reps,weight,done))").eq("user_id", userId).order("workout_date", { ascending: false }).limit(input.limit);
      if (input.fromDate) query = query.gte("workout_date", input.fromDate);
      if (input.toDate) query = query.lte("workout_date", input.toDate);
      const { data, error } = await query;
      if (error) { await logAction("get_workout_history", "Échec lecture historique", input, "failed"); return { ok: false, message: "Lecture de l’historique Sport impossible." }; }
      return { ok: true, data: data ?? [], message: `${(data ?? []).length} séance(s) trouvée(s).` };
    }) });

  const getProgress = tool({ description: "Lire la progression d'un exercice Sport: dernières séries et meilleur poids/répétitions.", inputSchema: z.object({ exerciseId: z.string().uuid(), limit: z.number().int().positive().max(100).default(20) }),
    execute: guard("get_exercise_progress", async (input) => {
      const { data, error } = await client.from("sport_workout_sets").select("id,set_number,reps,weight,done,created_at,sport_workout_exercises!inner(exercise_id,session_id,sport_workout_sessions!inner(id,name,workout_date,user_id))").eq("sport_workout_exercises.exercise_id", input.exerciseId).eq("sport_workout_exercises.sport_workout_sessions.user_id", userId).order("created_at", { ascending: false }).limit(input.limit);
      if (error) { await logAction("get_exercise_progress", "Échec lecture progression", input, "failed"); return { ok: false, message: "Lecture de la progression impossible." }; }
      const rows = data ?? [];
      const bestWeight = rows.reduce((max, row) => Math.max(max, Number(row.weight ?? 0)), 0);
      const bestRepsAtWeight = rows.reduce((best, row) => Number(row.weight ?? 0) > Number(best.weight ?? 0) || (Number(row.weight ?? 0) === Number(best.weight ?? 0) && Number(row.reps ?? 0) > Number(best.reps ?? 0)) ? row : best, rows[0] ?? null);
      return { ok: true, data: { sets: rows, bestWeight, bestRepsAtWeight }, message: `${rows.length} série(s) de progression trouvée(s).` };
    }) });

  return {
    create_exercise: createExercise,
    update_exercise: updateExercise,
    delete_exercise: deleteExercise,
    create_program: createProgram,
    update_program: updateProgram,
    delete_program: deleteProgram,
    add_exercise_to_program: addExerciseToProgram,
    remove_exercise_from_program: removeExerciseFromProgram,
    start_workout: startWorkout,
    add_workout_exercise: addWorkoutExercise,
    add_workout_set: addWorkoutSet,
    update_workout_set: updateWorkoutSet,
    finish_workout: finishWorkout,
    get_workout_history: getHistory,
    get_exercise_progress: getProgress,
  };
}
