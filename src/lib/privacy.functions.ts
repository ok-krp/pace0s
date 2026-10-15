import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EXPORT_TABLES = [
  "profiles",
  "food_log",
  "food_scans",
  "health_samples",
  "health_samples_e2ee",
  "health_e2ee_devices",
  "health_e2ee_key_envelopes",
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
  "sport_program_items",
  "sport_progression_targets",
  "sport_workout_sessions",
  "sport_workout_exercises",
  "sport_workout_sets",
] as const;

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
  "health_e2ee_key_envelopes",
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
  const findActive = async () => {
    const { data, error } = await adminDb
      .from("data_deletion_requests")
      .select("id,status")
      .eq("user_id", userId)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("account deletion request lookup failed");
    return data as { id: string; status: string } | null;
  };

  const claimPending = async (requestId: string) => {
    const { data, error } = await adminDb
      .from("data_deletion_requests")
      .update({ status: "processing", error_code: null })
      .eq("id", requestId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new Error("account deletion request claim failed");
    return data as { id: string } | null;
  };

  const existing = await findActive();
  if (existing?.status === "processing") {
    throw new Error("Une suppression est déjà en cours.");
  }
  if (existing?.status === "pending") {
    const claimed = await claimPending(existing.id);
    if (claimed) return claimed;
    const raced = await findActive();
    if (raced?.status === "processing") throw new Error("Une suppression est déjà en cours.");
    throw new Error("La demande de suppression a changé pendant sa prise en charge.");
  }

  const { data: created, error: createError } = await adminDb
    .from("data_deletion_requests")
    .insert({ user_id: userId, status: "processing" })
    .select("id")
    .maybeSingle();
  if (!createError && created) return created as { id: string };

  // If a concurrent request won the unique active-request constraint, reuse a
  // pending request if possible; never run two processing jobs concurrently.
  const raced = await findActive();
  if (raced?.status === "pending") {
    const claimed = await claimPending(raced.id);
    if (claimed) return claimed;
  }
  console.error("account deletion request failed", { error: createError?.message });
  throw new Error("Une suppression est déjà en cours ou ne peut pas être démarrée.");
}

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tables: Record<string, unknown[]> = {};

    for (const table of EXPORT_TABLES) {
      const query = (supabaseAdmin as any).from(table).select("*");
      const { data, error } = await query.eq("user_id", context.userId);
      if (error) {
        console.error("privacy export failed", { table, error: error.message });
        throw new Error("Impossible d’exporter vos données.");
      }
      tables[table] = (data ?? []) as unknown[];
    }

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

      const [{ data: programs }, { data: sessions }] = await Promise.all([
        supabaseAdmin.from("sport_programs").select("id").eq("user_id", userId),
        supabaseAdmin.from("sport_workout_sessions").select("id").eq("user_id", userId),
      ]);
      const programIds = (programs ?? []).map((row) => row.id);
      const sessionIds = (sessions ?? []).map((row) => row.id);
      const workoutExercises = sessionIds.length
        ? (await supabaseAdmin.from("sport_workout_exercises").select("id").in("session_id", sessionIds)).data ?? []
        : [];
      const workoutExerciseIds = workoutExercises.map((row) => row.id);

      if (workoutExerciseIds.length) {
        const { error } = await supabaseAdmin.from("sport_workout_sets").delete().in("workout_exercise_id", workoutExerciseIds);
        if (error) throw new Error("cleanup:sport_workout_sets");
      }
      if (sessionIds.length) {
        const { error } = await supabaseAdmin.from("sport_workout_exercises").delete().in("session_id", sessionIds);
        if (error) throw new Error("cleanup:sport_workout_exercises");
      }
      if (programIds.length) {
        const { error } = await supabaseAdmin.from("sport_program_items").delete().in("program_id", programIds);
        if (error) throw new Error("cleanup:sport_program_items");
      }

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
