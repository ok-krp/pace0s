import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EXPORT_TABLES = [
  "profiles",
  "food_log",
  "food_scans",
  "health_samples",
  "health_samples_e2ee",
  "health_legacy_migration_map",
  "health_e2ee_devices",
  "health_e2ee_key_versions",
  "health_e2ee_key_envelopes",
  "health_e2ee_recovery_envelopes",
  "health_e2ee_pairing_sessions",
  "legal_consent",
  "consent_records",
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

const EXPORT_ORDER_BY: Record<string, string> = {
  food_log: "id",
  food_scans: "id",
  health_samples: "id",
  health_samples_e2ee: "id",
  health_legacy_migration_map: "legacy_sample_id",
  health_e2ee_devices: "id",
  health_e2ee_key_envelopes: "id",
  health_e2ee_recovery_envelopes: "id",
  health_e2ee_pairing_sessions: "id",
  consent_records: "id",
  user_state: "id",
  notification_log: "id",
  push_subscriptions: "id",
  reminder_debug_log: "id",
  ai_action_log: "id",
  ai_conversations: "id",
  ai_messages: "id",
  development_tasks: "id",
  sport_exercises: "id",
  sport_programs: "id",
  sport_program_items: "id",
  sport_progression_targets: "id",
  sport_workout_sessions: "id",
  sport_workout_exercises: "id",
  sport_workout_sets: "id",
};

async function fetchRowsForParentIds(
  supabaseAdmin: any,
  table: string,
  parentColumn: string,
  parentIds: string[],
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const parentBatchSize = 100;
  const pageSize = 500;

  for (let parentOffset = 0; parentOffset < parentIds.length; parentOffset += parentBatchSize) {
    const parentBatch = parentIds.slice(parentOffset, parentOffset + parentBatchSize);
    let offset = 0;
    while (true) {
      const { data, error } = await (supabaseAdmin as any)
        .from(table)
        .select("*")
        .in(parentColumn, parentBatch)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`privacy export failed for ${table}`);
      const page = (data ?? []) as unknown[];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += page.length;
    }
  }
  return rows;
}

async function fetchIdsForParentIds(
  supabaseAdmin: any,
  table: string,
  parentColumn: string,
  parentIds: string[],
): Promise<string[]> {
  const ids: string[] = [];
  const parentBatchSize = 100;
  const pageSize = 500;

  for (let parentOffset = 0; parentOffset < parentIds.length; parentOffset += parentBatchSize) {
    const parentBatch = parentIds.slice(parentOffset, parentOffset + parentBatchSize);
    let offset = 0;
    while (true) {
      const { data, error } = await (supabaseAdmin as any)
        .from(table)
        .select("id")
        .in(parentColumn, parentBatch)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`cleanup:${table}:lookup`);
      const page = (data ?? []) as Array<{ id: string }>;
      ids.push(...page.map((row) => row.id));
      if (page.length < pageSize) break;
      offset += page.length;
    }
  }
  return ids;
}

async function deleteByParentIdsInBatches(
  supabaseAdmin: any,
  table: string,
  parentColumn: string,
  parentIds: string[],
): Promise<void> {
  const batchSize = 100;
  for (let offset = 0; offset < parentIds.length; offset += batchSize) {
    const { error } = await (supabaseAdmin as any)
      .from(table)
      .delete()
      .in(parentColumn, parentIds.slice(offset, offset + batchSize));
    if (error) throw new Error(`cleanup:${table}`);
  }
}

async function fetchAllExportRows(supabaseAdmin: any, table: string, userId: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const pageSize = 500;
  const orderColumn = EXPORT_ORDER_BY[table];
  if (!orderColumn) {
    const { data, error } = await (supabaseAdmin as any)
      .from(table)
      .select("*")
      .eq("user_id", userId);
    if (error) throw new Error(`privacy export failed for ${table}`);
    return (data ?? []) as unknown[];
  }

  let offset = 0;
  while (true) {
    const { data, error } = await (supabaseAdmin as any)
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`privacy export failed for ${table}`);
    const page = (data ?? []) as unknown[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return rows;
}

type StorageListBucket = {
  list: (prefix: string, options: { limit: number; offset: number; sortBy: { column: string; order: "asc" | "desc" } }) => Promise<{
    data: Array<{ name: string; id: string | null }> | null;
    error: { message: string } | null;
  }>;
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
};

/** Enumerate before deleting so offset pagination cannot skip objects as pages shrink. */
async function listStorageObjectPaths(bucket: StorageListBucket, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const { data, error } = await bucket.list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error("cleanup:storage:list");

    const entries = data ?? [];
    for (const entry of entries) {
      const objectPath = `${prefix}/${entry.name}`;
      if (entry.id == null) {
        paths.push(...await listStorageObjectPaths(bucket, objectPath));
      } else {
        paths.push(objectPath);
      }
    }

    if (entries.length < pageSize) break;
    offset += entries.length;
  }

  return paths;
}

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
  "health_legacy_migration_map",
  "health_e2ee_key_envelopes",
  "health_e2ee_recovery_envelopes",
  "health_e2ee_key_versions",
  "health_e2ee_pairing_sessions",
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
  "profiles",
] as const;

async function claimDeletionRequest(userId: string, supabaseAdmin: unknown): Promise<{ id: string }> {
  const adminDb = supabaseAdmin as any;
  const { data, error } = await adminDb.rpc("claim_account_deletion_request", {
    p_user_id: userId,
  });
  if (error) {
    if (/already processing/i.test(error.message ?? "")) {
      throw new Error("Une suppression est déjà en cours.");
    }
    console.error("account deletion request claim failed", { error: error.message });
    throw new Error("Impossible de démarrer la suppression du compte.");
  }
  if (typeof data !== "string" || !data) {
    throw new Error("Impossible de démarrer la suppression du compte.");
  }
  return { id: data };
}

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tables: Record<string, unknown[]> = {};

    for (const table of EXPORT_TABLES) {
      try {
        tables[table] = await fetchAllExportRows(supabaseAdmin, table, context.userId);
      } catch (error) {
        console.error("privacy export failed", { table, error: error instanceof Error ? error.message : "unknown" });
        throw new Error("Impossible d’exporter vos données.");
      }
    }

    // These child tables inherit ownership through their parent and therefore
    // have no user_id column. Export them by IDs of the authenticated user's
    // parent rows rather than querying them globally.
    const programs = (tables.sport_programs ?? []) as Array<{ id: string }>;
    const sessions = (tables.sport_workout_sessions ?? []) as Array<{ id: string }>;
    const programIds = programs.map((row) => row.id);
    const sessionIds = sessions.map((row) => row.id);

    const programItems = await fetchRowsForParentIds(supabaseAdmin, "sport_program_items", "program_id", programIds);
    tables.sport_program_items = programItems;

    const workoutExercises = await fetchRowsForParentIds(supabaseAdmin, "sport_workout_exercises", "session_id", sessionIds);
    tables.sport_workout_exercises = workoutExercises;

    const workoutExerciseIds = workoutExercises.map((row) => (row as { id: string }).id);
    tables.sport_workout_sets = await fetchRowsForParentIds(
      supabaseAdmin,
      "sport_workout_sets",
      "workout_exercise_id",
      workoutExerciseIds,
    );

    return {
      generated_at: new Date().toISOString(),
      user_id: context.userId,
      email: (context.claims?.email as string | undefined) ?? null,
      schema_version: 2,
      json: JSON.stringify(tables),
    };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const request = await claimDeletionRequest(userId, supabaseAdmin);

    try {
      // Storage objects are not removed by deleting the Auth user. Complete
      // and verify this cleanup before deleting any SQL rows.
      const nutritionBucket = supabaseAdmin.storage.from("nutrition-ai") as unknown as StorageListBucket;
      const nutritionPaths = await listStorageObjectPaths(nutritionBucket, userId);
      for (let offset = 0; offset < nutritionPaths.length; offset += 100) {
        const { error } = await nutritionBucket.remove(nutritionPaths.slice(offset, offset + 100));
        if (error) throw new Error("cleanup:storage:nutrition-ai");
      }
      // Verify the bucket prefix is empty before removing the SQL ownership
      // records or Auth user; a partial Storage failure must stop deletion.
      const remainingNutritionPaths = await listStorageObjectPaths(nutritionBucket, userId);
      if (remainingNutritionPaths.length > 0) {
        throw new Error("cleanup:storage:nutrition-ai:objects-remain");
      }

      // Enumerate every owned parent and child row in stable pages before
      // deleting any workout data. This avoids PostgREST row caps and oversized IN clauses.
      const programs = await fetchAllExportRows(supabaseAdmin, "sport_programs", userId) as Array<{ id: string }>;
      const sessions = await fetchAllExportRows(supabaseAdmin, "sport_workout_sessions", userId) as Array<{ id: string }>;
      const programIds = programs.map((row) => row.id);
      const sessionIds = sessions.map((row) => row.id);
      const workoutExerciseIds = await fetchIdsForParentIds(
        supabaseAdmin,
        "sport_workout_exercises",
        "session_id",
        sessionIds,
      );

      await deleteByParentIdsInBatches(supabaseAdmin, "sport_workout_sets", "workout_exercise_id", workoutExerciseIds);
      await deleteByParentIdsInBatches(supabaseAdmin, "sport_workout_exercises", "session_id", sessionIds);
      await deleteByParentIdsInBatches(supabaseAdmin, "sport_program_items", "program_id", programIds);

      const adminDb = supabaseAdmin as any;
      for (const table of DELETE_TABLES) {
        const { error } = await adminDb.from(table).delete().eq("user_id", userId);
        if (error) throw new Error(`cleanup:${table}`);
      }

      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw new Error("auth:user");

      return { ok: true };
    } catch (error) {
      await supabaseAdmin
        .from("data_deletion_requests")
        .update({ status: "failed", error_code: error instanceof Error ? error.message : "unknown" })
        .eq("id", request.id);
      console.error("account deletion failed", { error });
      throw new Error("Impossible de supprimer le compte.");
    }
  });
