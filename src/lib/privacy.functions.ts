import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EXPORT_USER_TABLES = [
  "profiles",
  "food_log",
  "food_scans",
  "health_samples",
  "health_samples_e2ee",
  "health_e2ee_devices",
  "health_e2ee_key_envelopes",
  "health_e2ee_key_versions",
  "health_e2ee_pairing_sessions",
  "health_e2ee_recovery_envelopes",
  "user_biometrics_e2ee",
  "legal_consent",
  "consent_records",
  "data_deletion_requests",
  "nutrition_calibration_feedback",
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
  "health_e2ee_key_envelopes",
  "health_e2ee_devices",
  "nutrition_calibration_feedback",
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
  "profiles",
] as const;

const PAGE_SIZE = 500;
const ID_BATCH_SIZE = 200;

async function readAllRows(
  label: string,
  queryFactory: () => any,
): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await queryFactory().range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error("privacy data query failed", { table: label, error: error.message });
      throw new Error("Impossible de traiter toutes vos données.");
    }
    const page = (data ?? []) as Record<string, any>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function readRowsForIds(
  label: string,
  rawIds: unknown[],
  queryFactory: (ids: string[]) => any,
): Promise<Record<string, any>[]> {
  const ids = [...new Set(rawIds.filter((value): value is string => typeof value === "string" && value.length > 0))];
  const rows: Record<string, any>[] = [];
  for (let offset = 0; offset < ids.length; offset += ID_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + ID_BATCH_SIZE);
    rows.push(...await readAllRows(label, () => queryFactory(batch)));
  }
  return rows;
}

async function removeOwnedStorageObjects(adminDb: any, userId: string): Promise<void> {
  const objects = await readAllRows(
    "list_account_storage_objects",
    () => adminDb.rpc("list_account_storage_objects", { p_user_id: userId }),
  );

  const byBucket = new Map<string, string[]>();
  for (const object of objects) {
    if (typeof object.bucket_id !== "string" || typeof object.name !== "string" || !object.name) continue;
    const paths = byBucket.get(object.bucket_id) ?? [];
    paths.push(object.name);
    byBucket.set(object.bucket_id, paths);
  }

  for (const [bucket, rawPaths] of byBucket) {
    const paths = [...new Set(rawPaths)];
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await adminDb.storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (error) {
        console.error("account storage cleanup failed", { bucket, error: error.message });
        throw new Error("cleanup:storage");
      }
    }
  }
}

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as any;
    const tables: Record<string, unknown[]> = {};

    for (const table of EXPORT_USER_TABLES) {
      tables[table] = await readAllRows(
        table,
        () => adminDb.from(table).select("*").eq("user_id", context.userId),
      );
    }

    // Export relational sport data through its actual parent keys. These child
    // tables deliberately do not contain user_id columns.
    const programIds = tables.sport_programs.map((row: any) => row.id);
    const sessionIds = tables.sport_workout_sessions.map((row: any) => row.id);
    tables.sport_program_items = await readRowsForIds(
      "sport_program_items",
      programIds,
      (ids) => adminDb.from("sport_program_items").select("*").in("program_id", ids),
    );
    tables.sport_workout_exercises = await readRowsForIds(
      "sport_workout_exercises",
      sessionIds,
      (ids) => adminDb.from("sport_workout_exercises").select("*").in("session_id", ids),
    );
    const workoutExerciseIds = tables.sport_workout_exercises.map((row: any) => row.id);
    tables.sport_workout_sets = await readRowsForIds(
      "sport_workout_sets",
      workoutExerciseIds,
      (ids) => adminDb.from("sport_workout_sets").select("*").in("workout_exercise_id", ids),
    );

    // Include every workspace the user owns or belongs to, plus the relational
    // shopping-list and pantry data visible inside those workspaces.
    const [ownedWorkspaces, memberships] = await Promise.all([
      readAllRows("workspaces", () => adminDb.from("workspaces").select("id").eq("owner_user_id", context.userId)),
      readAllRows("workspace_members", () => adminDb.from("workspace_members").select("workspace_id").eq("user_id", context.userId)),
    ]);
    const workspaceIds = [
      ...new Set([
        ...ownedWorkspaces.map((row) => row.id),
        ...memberships.map((row) => row.workspace_id),
      ].filter((value): value is string => typeof value === "string" && value.length > 0)),
    ];

    tables.workspaces = await readRowsForIds(
      "workspaces",
      workspaceIds,
      (ids) => adminDb.from("workspaces").select("*").in("id", ids),
    );
    tables.workspace_members = await readRowsForIds(
      "workspace_members",
      workspaceIds,
      (ids) => adminDb.from("workspace_members").select("*").in("workspace_id", ids),
    );
    tables.grocery_lists = await readRowsForIds(
      "grocery_lists",
      workspaceIds,
      (ids) => adminDb.from("grocery_lists").select("*").in("workspace_id", ids),
    );
    const groceryListIds = tables.grocery_lists.map((row: any) => row.id);
    tables.grocery_list_items = await readRowsForIds(
      "grocery_list_items",
      groceryListIds,
      (ids) => adminDb.from("grocery_list_items").select("*").in("grocery_list_id", ids),
    );
    tables.pantry_items = await readRowsForIds(
      "pantry_items",
      workspaceIds,
      (ids) => adminDb.from("pantry_items").select("*").in("workspace_id", ids),
    );

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
    const adminDb = supabaseAdmin as any;

    const { data: request, error: requestError } = await adminDb
      .from("data_deletion_requests")
      .insert({ user_id: userId, status: "processing" })
      .select("id")
      .single();

    if (requestError) {
      console.error("account deletion request failed", { error: requestError.message });
      throw new Error("Une suppression est déjà en cours ou ne peut pas être démarrée.");
    }

    try {
      // Ownership handoff is atomic and runs before the Auth user is deleted.
      // It preserves shared workspaces and deletes only workspaces with no
      // surviving member.
      const { error: workspaceError } = await adminDb.rpc("prepare_account_deletion", {
        p_user_id: userId,
      });
      if (workspaceError) throw new Error("cleanup:workspaces");

      const [{ data: programs, error: programsError }, { data: sessions, error: sessionsError }] = await Promise.all([
        adminDb.from("sport_programs").select("id").eq("user_id", userId),
        adminDb.from("sport_workout_sessions").select("id").eq("user_id", userId),
      ]);
      if (programsError || sessionsError) throw new Error("cleanup:sport_parents");
      const programIds = (programs ?? []).map((row: any) => row.id);
      const sessionIds = (sessions ?? []).map((row: any) => row.id);
      const workoutExercises = sessionIds.length
        ? (await adminDb.from("sport_workout_exercises").select("id").in("session_id", sessionIds))
        : { data: [], error: null };
      if (workoutExercises.error) throw new Error("cleanup:sport_workout_exercises");
      const workoutExerciseIds = (workoutExercises.data ?? []).map((row: any) => row.id);

      if (workoutExerciseIds.length) {
        const { error } = await adminDb.from("sport_workout_sets").delete().in("workout_exercise_id", workoutExerciseIds);
        if (error) throw new Error("cleanup:sport_workout_sets");
      }
      if (sessionIds.length) {
        const { error } = await adminDb.from("sport_workout_exercises").delete().in("session_id", sessionIds);
        if (error) throw new Error("cleanup:sport_workout_exercises");
      }
      if (programIds.length) {
        const { error } = await adminDb.from("sport_program_items").delete().in("program_id", programIds);
        if (error) throw new Error("cleanup:sport_program_items");
      }

      await removeOwnedStorageObjects(adminDb, userId);

      for (const table of DELETE_TABLES) {
        const { error } = await adminDb.from(table).delete().eq("user_id", userId);
        if (error) throw new Error(`cleanup:${table}`);
      }

      const { error: completedError } = await adminDb
        .from("data_deletion_requests")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          error_code: null,
        })
        .eq("id", request.id);
      if (completedError) throw new Error("cleanup:deletion_request");

      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw new Error("auth:user");

      return { ok: true };
    } catch (error) {
      await adminDb
        .from("data_deletion_requests")
        .update({
          status: "failed",
          completed_at: null,
          error_code: error instanceof Error ? error.message : "unknown",
        })
        .eq("id", request.id);
      console.error("account deletion failed", { error });
      throw new Error("Impossible de supprimer le compte.");
    }
  });
