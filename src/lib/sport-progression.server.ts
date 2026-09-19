import { generateText } from "ai";
import { z } from "zod";
import { getAiRuntimeConfig } from "./ai-provider.server";
import type { Json } from "@/integrations/supabase/types";

const inputSchema = z.object({
  sessionId: z.string().uuid(),
  exerciseIds: z.array(z.string().uuid()).min(1).max(100),
});

type ProgressionTarget = {
  exerciseId: string;
  targetSets: number;
  targetReps: number;
  targetWeight: number;
  strategy: string;
  rationale: string;
  basedOnSessionId: string;
};

type WorkoutSet = { reps: number; weight: number; done: boolean };
type WorkoutExercise = { exercise_id: string; session_id: string; position: number; sets: WorkoutSet[] };
type WorkoutSession = { id: string; workout_date: string; name: string; duration_min: number | null; workout_exercises: WorkoutExercise[] };
type ExerciseRow = { id: string; name: string; muscle: string; equipment: string | null; default_sets: number | null; default_reps: number | null; default_weight: number | null };

function roundWeight(value: number) {
  return Math.round(value * 2) / 2;
}

function fallbackTarget(
  exerciseId: string,
  sessions: WorkoutSession[],
  exercise: { default_sets: number | null; default_reps: number | null; default_weight: number | null; equipment: string | null },
): ProgressionTarget | null {
  const history = sessions
    .map((session) => ({ session, exercise: session.workout_exercises.find((item) => item.exercise_id === exerciseId) }))
    .filter((item): item is { session: WorkoutSession; exercise: WorkoutExercise } => Boolean(item.exercise))
    .map(({ session, exercise: workoutExercise }) => ({
      session,
      done: workoutExercise.sets.filter((set) => set.done),
    }))
    .filter((item) => item.done.length > 0)
    .slice(0, 4);

  if (!history.length) return null;
  const latest = history[0];
  const latestWeight = Math.max(...latest.done.map((set) => set.weight));
  const latestReps = Math.max(...latest.done.map((set) => set.reps));
  const latestSets = latest.done.length;
  const previous = history[1]?.done ?? [];
  const averageReps = latest.done.reduce((sum, set) => sum + set.reps, 0) / latest.done.length;
  const previousAverage = previous.length ? previous.reduce((sum, set) => sum + set.reps, 0) / previous.length : 0;
  const bodyweight = /poids du corps|sans matériel|bodyweight|traction|dips/i.test(exercise.equipment ?? "");
  const baseReps = Math.max(1, exercise.default_reps ?? latestReps);
  const baseSets = Math.max(1, exercise.default_sets ?? latestSets);
  const canLoad = !bodyweight && latestWeight > 0;

  if (averageReps >= baseReps + 2 && previousAverage >= baseReps + 2 && canLoad) {
    return {
      exerciseId,
      targetSets: latestSets,
      targetReps: Math.max(1, baseReps),
      targetWeight: roundWeight(latestWeight * 1.05),
      strategy: "load_increase",
      rationale: "Deux séances consécutives au-dessus de la plage cible permettent une hausse de charge modérée.",
      basedOnSessionId: latest.session.id,
    };
  }

  if (averageReps >= baseReps && latestSets >= baseSets) {
    return {
      exerciseId,
      targetSets: latestSets,
      targetReps: Math.min(baseReps + 2, Math.max(baseReps + 1, Math.round(averageReps) + 1)),
      targetWeight: latestWeight,
      strategy: "rep_progression",
      rationale: "La charge est conservée et les répétitions progressent avant une nouvelle hausse de poids.",
      basedOnSessionId: latest.session.id,
    };
  }

  if (latest.done.every((set) => set.reps >= 1) && latestSets < baseSets + 1) {
    return {
      exerciseId,
      targetSets: latestSets + 1,
      targetReps: Math.max(1, Math.round(averageReps)),
      targetWeight: latestWeight,
      strategy: "set_progression",
      rationale: "Le volume augmente d'une série pour consolider la progression sans forcer une hausse de charge.",
      basedOnSessionId: latest.session.id,
    };
  }

  return {
    exerciseId,
    targetSets: latestSets,
    targetReps: Math.max(1, latestReps),
    targetWeight: latestWeight,
    strategy: "repeat_and_consolidate",
    rationale: "La dernière performance est reconduite pour consolider la technique et la régularité.",
    basedOnSessionId: latest.session.id,
  };
}

function parseAiJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Réponse IA de progression invalide.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function generateSportProgressionServer(context: { supabase: any; userId: string }, data: z.infer<typeof inputSchema>) {
    const { sessionId, exerciseIds } = data;

    const { data: exercises, error: exerciseError } = await context.supabase
      .from("sport_exercises")
      .select("id,name,muscle,equipment,default_sets,default_reps,default_weight")
      .eq("user_id", context.userId)
      .in("id", exerciseIds);

    if (exerciseError) throw new Error("Impossible de charger les exercices Sport.");

    const { data: sessions, error: sessionError } = await context.supabase
      .from("sport_workout_sessions")
      .select("id,workout_date,name,duration_min,sport_workout_exercises(exercise_id,session_id,position,sport_workout_sets(reps,weight,done))")
      .eq("user_id", context.userId)
      .order("workout_date", { ascending: false })
      .limit(200);

    if (sessionError) throw new Error("Impossible de charger l'historique Sport.");

    const normalizedSessions = (sessions ?? []) as unknown as WorkoutSession[];
    const recentSessions = normalizedSessions.filter((session) =>
      session.workout_exercises?.some((item) => exerciseIds.includes(item.exercise_id)),
    );

    const typedExercises = (exercises ?? []) as ExerciseRow[];

    const fallback = typedExercises
      .map((exercise) => fallbackTarget(exercise.id, recentSessions, exercise))
      .filter((target): target is ProgressionTarget => Boolean(target));

    if (!fallback.length) return { targets: [], source: "none" as const };

    try {
      const runtime = await getAiRuntimeConfig(context.supabase, context.userId, "coach");
      const exercisePayload = typedExercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        muscle: exercise.muscle,
        equipment: exercise.equipment,
        default: {
          sets: exercise.default_sets,
          reps: exercise.default_reps,
          weight: Number(exercise.default_weight ?? 0),
        },
        history: recentSessions
          .filter((session) => session.workout_exercises?.some((item) => item.exercise_id === exercise.id))
          .slice(0, 5)
          .map((session) => {
            const item = session.workout_exercises.find((candidate) => candidate.exercise_id === exercise.id)!;
            return {
              sessionId: session.id,
              date: session.workout_date,
              name: session.name,
              durationMin: session.duration_min,
              sets: item.sets.map((set) => ({ reps: set.reps, weight: Number(set.weight), done: set.done })),
            };
          }),
      }));

      const prompt = [
        "Tu es le moteur de surcharge progressive de Pace. Tu dois choisir la cible de la prochaine séance à partir des performances réelles.",
        "Ne demande jamais une validation à l'utilisateur. Réponds uniquement par un tableau JSON.",
        "Priorités: sécurité et progression soutenable > volume inutile. Utilise la double progression, la progression de charge par petits incréments, la progression des reps, l'ajout/retrait d'une série, la consolidation et le deload si les performances régressent.",
        "N'augmente pas la charge si la performance récente est instable, si le volume chute, ou pour un exercice au poids du corps. Pour un poids du corps, augmente d'abord les reps puis les séries.",
        "Évite de modifier simultanément poids + reps + séries sauf si l'historique justifie clairement un micro-cycle. Une cible doit être concrète, réalisable à la prochaine séance.",
        "Si plusieurs séances récentes montrent une progression nette, privilégie une petite hausse de charge (environ 2.5 à 5%, jamais plus de 10%) et reviens vers le bas de la plage de reps.",
        "Si la charge est stable mais que les reps montent, augmente les reps de 1 à 2 avant la charge.",
        "Si la récupération semble insuffisante d'après les performances et le volume, conserve ou réduis légèrement le volume plutôt que de forcer.",
        "Les valeurs doivent être des entiers pour séries/reps et un poids arrondi au 0.5 kg.",
        "Chaque objet doit contenir: exerciseId, targetSets, targetReps, targetWeight, strategy, rationale, basedOnSessionId.",
        "strategy doit être l'une de: load_increase, rep_progression, set_progression, deload, repeat_and_consolidate.",
        JSON.stringify(exercisePayload),
      ].join("\n");

      const result = await generateText({
        model: runtime.gateway(runtime.model),
        prompt,
        maxRetries: 1,
        maxOutputTokens: 3000,
      });

      const schema = z.array(z.object({
        exerciseId: z.string().uuid(),
        targetSets: z.number().int().min(1).max(20),
        targetReps: z.number().int().min(1).max(100),
        targetWeight: z.number().min(0).max(2000),
        strategy: z.enum(["load_increase", "rep_progression", "set_progression", "deload", "repeat_and_consolidate"]),
        rationale: z.string().min(1).max(500),
        basedOnSessionId: z.string().uuid(),
      })).max(100);

      const aiTargets = schema.parse(parseAiJson(result.text));
      const validIds = new Set(exerciseIds);
      const validSessionIds = new Set(recentSessions.map((session) => session.id));
      const safeTargets = aiTargets.filter((target) => validIds.has(target.exerciseId) && validSessionIds.has(target.basedOnSessionId));
      if (!safeTargets.length) throw new Error("LIA n’a pas fourni de cibles valides.");

      for (const target of safeTargets) {
        await context.supabase.from("sport_progression_targets").upsert({
          user_id: context.userId,
          exercise_id: target.exerciseId,
          target_sets: target.targetSets,
          target_reps: target.targetReps,
          target_weight: Math.round(target.targetWeight * 2) / 2,
          strategy: target.strategy,
          rationale: target.rationale,
          based_on_session_id: target.basedOnSessionId,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,exercise_id" });
      }

      if (safeTargets.length) {
        await context.supabase.from("ai_action_log").insert({
          user_id: context.userId,
          agent_type: "coach",
          action_type: "sport_progression",
          label: "Surcharge progressive automatique",
          payload: safeTargets as unknown as Json,
          status: "executed",
          executed_at: new Date().toISOString(),
        });
      }

      return { targets: safeTargets, source: "ai" as const };
    } catch (error) {
      console.warn("[sport-progression] IA indisponible, fallback déterministe", error instanceof Error ? error.message : "unknown");

      for (const target of fallback) {
        await context.supabase.from("sport_progression_targets").upsert({
          user_id: context.userId,
          exercise_id: target.exerciseId,
          target_sets: target.targetSets,
          target_reps: target.targetReps,
          target_weight: target.targetWeight,
          strategy: target.strategy,
          rationale: target.rationale,
          based_on_session_id: target.basedOnSessionId,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,exercise_id" });
      }

      return { targets: fallback, source: "fallback" as const };
    }
}
