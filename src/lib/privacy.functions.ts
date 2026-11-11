import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Only rows with an owner column are queried through this allowlist. The
// server derives user_id from the authenticated session; callers cannot choose it.
const EXPORT_TABLES = [
  "profiles",
  "food_log",
  "food_scans",
  "health_samples",
  "health_samples_e2ee",
  "user_biometrics_e2ee",
  "health_e2ee_devices",
  "health_e2ee_key_versions",
  "health_e2ee_key_envelopes",
  "health_e2ee_recovery_envelopes",
  "health_legacy_migration_map",
  "legal_consent",
  "consent_records",
  "data_deletion_requests",
  "notification_log",
  "push_subscriptions",
  "reminder_settings",
  "reminder_debug_log",
  "user_state",
  "ai_action_log",
  "ai_conversations",
  "ai_messages",
  "ai_preferences",
  "development_tasks",
  "billing_customers",
  "billing_subscriptions",
  "billing_trials",
  "sport_exercises",
  "sport_programs",
  "sport_progression_targets",
  "sport_workout_sessions",
] as const;

// These tables all have a user_id owner column. Backend-only secrets and
// idempotency rows are deleted but deliberately excluded from the data export.
const DELETE_TABLES = [
  "ai_messages",
  "development_tasks",
  "ai_action_log",
  "ai_conversations",
  "ai_preferences",
  "ai_provider_secrets",
  "ai_tool_idempotency",
  "sport_progression_targets",
  "sport_workout_sessions",
  "sport_programs",
  "sport_exercises",
  "food_log",
  "food_scans",
  "health_samples",
  "health_samples_e2ee",
  "user_biometrics_e2ee",
  "health_e2ee_key_envelopes",
  "health_e2ee_pairing_sessions",
  "health_e2ee_key_versions",
  "health_e2ee_recovery_envelopes",
  "health_legacy_migration_map",
  "health_e2ee_devices",
  "notification_log",
  "push_subscriptions",
  "reminder_debug_log",
  "reminder_settings",
  "user_state",
  "billing_subscriptions",
  "billing_trials",
  "billing_customers",
  "legal_consent",
  "consent_records",
  "data_deletion_requests",
  "profiles",
] as const;

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // A privacy export must remain available after a user withdraws health-sync
    // consent. Use the server-only admin client, with an explicit owner filter
    // on every allowlisted table; never accept a user_id from the request.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const tables: Record<string, unknown[]> = {};

    for (const table of EXPORT_TABLES) {
      const { data, error } = await db.from(table).select("*").eq("user_id", context.userId);
      if (error) {
        console.error("privacy export failed", { table, code: error.code ?? "unknown" });
        throw new Error("Impossible d’exporter vos données.");
      }
      tables[table] = (data ?? []) as unknown[];
    }

    // These normalized Sport children have no user_id column. Resolve their
    // parents from the already owner-filtered export, then fetch only by IDs.
    const programIds = (tables.sport_programs ?? [])
      .map((row) => (row as { id?: string }).id)
      .filter((id): id is string => typeof id === "string");
    const sessionIds = (tables.sport_workout_sessions ?? [])
      .map((row) => (row as { id?: string }).id)
      .filter((id): id is string => typeof id === "string");

    tables.sport_program_items = [];
    if (programIds.length > 0) {
      const { data, error } = await db.from("sport_program_items").select("*").in("program_id", programIds);
      if (error) throw new Error("Impossible d’exporter les éléments des programmes sportifs.");
      tables.sport_program_items = (data ?? []) as unknown[];
    }

    tables.sport_workout_exercises = [];
    tables.sport_workout_sets = [];
    if (sessionIds.length > 0) {
      const { data, error } = await db.from("sport_workout_exercises").select("*").in("session_id", sessionIds);
      if (error) throw new Error("Impossible d’exporter les exercices des séances sportives.");
      const exercises = (data ?? []) as Array<{ id: string }>;
      tables.sport_workout_exercises = exercises;
      const exerciseIds = exercises.map((row) => row.id);
      if (exerciseIds.length > 0) {
        const { data: sets, error: setsError } = await db
          .from("sport_workout_sets").select("*").in("workout_exercise_id", exerciseIds);
        if (setsError) throw new Error("Impossible d’exporter les séries sportives.");
        tables.sport_workout_sets = (sets ?? []) as unknown[];
      }
    }

    return {
      generated_at: new Date().toISOString(),
      user_id: context.userId,
      email: (context.claims?.email as string | undefined) ?? null,
      schema_version: 3,
      json: JSON.stringify(tables),
    };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Remove relationship-only Sport rows before deleting their parents. This
    // also works on older databases where the expected foreign keys are absent.
    const [{ data: programs, error: programsError }, { data: sessions, error: sessionsError }] =
      await Promise.all([
        db.from("sport_programs").select("id").eq("user_id", userId),
        db.from("sport_workout_sessions").select("id").eq("user_id", userId),
      ]);
    if (programsError || sessionsError) {
      throw new Error("Impossible de préparer la suppression des données sportives.");
    }

    const programIds = (programs ?? []).map((row: { id: string }) => row.id);
    const sessionIds = (sessions ?? []).map((row: { id: string }) => row.id);

    if (sessionIds.length > 0) {
      const { data: exercises, error } = await db
        .from("sport_workout_exercises").select("id").in("session_id", sessionIds);
      if (error) throw new Error("Impossible de préparer la suppression des exercices sportifs.");
      const exerciseIds = (exercises ?? []).map((row: { id: string }) => row.id);
      if (exerciseIds.length > 0) {
        const { error: setsError } = await db
          .from("sport_workout_sets").delete().in("workout_exercise_id", exerciseIds);
        if (setsError) throw new Error("Impossible de supprimer les séries sportives.");
      }
      const { error: exercisesError } = await db
        .from("sport_workout_exercises").delete().in("session_id", sessionIds);
      if (exercisesError) throw new Error("Impossible de supprimer les exercices sportifs.");
    }

    if (programIds.length > 0) {
      const { error } = await db.from("sport_program_items").delete().in("program_id", programIds);
      if (error) throw new Error("Impossible de supprimer les éléments des programmes sportifs.");
    }

    // Fail closed: do not delete the auth user if any owned table failed to
    // clean up. The user can retry, and we avoid knowingly orphaning their data.
    for (const table of DELETE_TABLES) {
      const { error } = await db.from(table).delete().eq("user_id", userId);
      if (error) {
        console.error("account deletion cleanup failed", { table, code: error.code ?? "unknown" });
        throw new Error("Impossible de supprimer toutes les données du compte.");
      }
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error("Impossible de supprimer le compte.");
    return { ok: true };
  });
