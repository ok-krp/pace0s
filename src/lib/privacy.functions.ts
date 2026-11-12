import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  USER_DELETE_TABLES,
  USER_EXPORT_ORDER_COLUMNS,
  USER_EXPORT_RELATIONS,
  USER_EXPORT_TABLES,
} from "./privacy-data-scope";
import { collectUserExportPages } from "./privacy-data-export";

function stringIds(rows: readonly unknown[]): string[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || !("id" in row)) return [];
    const id = (row as { id?: unknown }).id;
    return typeof id === "string" ? [id] : [];
  });
}

/**
 * Portabilité (RGPD Art. 20 / LGPD Art. 18 / CCPA §1798.110).
 * All primary user-owned tables are filtered by user_id and paged at 500 rows.
 * Sport child rows without user_id are fetched only via the authenticated
 * user's program/session/exercise IDs.
 */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tables: Record<string, unknown[]> = {};
    for (const table of USER_EXPORT_TABLES) {
      const orderColumn = USER_EXPORT_ORDER_COLUMNS[table] ?? "id";
      tables[table] = await collectUserExportPages(async (from, to) => {
        const { data, error } = await context.supabase
          .from(table)
          .select("*")
          .eq("user_id", context.userId)
          .order(orderColumn as never, { ascending: true })
          .range(from, to);
        return { data, error };
      });
    }

    const programIds = stringIds(tables.sport_programs ?? []);
    tables.sport_program_items = programIds.length
      ? await collectUserExportPages(async (from, to) => {
          const { data, error } = await context.supabase
            .from("sport_program_items")
            .select("*")
            .in("program_id", programIds)
            .order("id", { ascending: true })
            .range(from, to);
          return { data, error };
        })
      : [];

    const sessionIds = stringIds(tables.sport_workout_sessions ?? []);
    tables.sport_workout_exercises = sessionIds.length
      ? await collectUserExportPages(async (from, to) => {
          const { data, error } = await context.supabase
            .from("sport_workout_exercises")
            .select("*")
            .in("session_id", sessionIds)
            .order("id", { ascending: true })
            .range(from, to);
          return { data, error };
        })
      : [];

    const workoutExerciseIds = stringIds(tables.sport_workout_exercises);
    tables.sport_workout_sets = workoutExerciseIds.length
      ? await collectUserExportPages(async (from, to) => {
          const { data, error } = await context.supabase
            .from("sport_workout_sets")
            .select("*")
            .in("workout_exercise_id", workoutExerciseIds)
            .order("id", { ascending: true })
            .range(from, to);
          return { data, error };
        })
      : [];

    return {
      generated_at: new Date().toISOString(),
      user_id: context.userId,
      email: (context.claims?.email as string | undefined) ?? null,
      schema_version: 2,
      json: JSON.stringify(tables),
    };
  });

/**
 * Droit à l'oubli (RGPD Art. 17 / LGPD Art. 18 / CCPA §1798.105).
 * Explicitly purges legacy user-owned rows that lack auth.users foreign keys.
 * Auth deletion is fail-closed on a table purge error.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const request = getRequest();
    const authorization = request?.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!token) throw new Error("Unable to revoke account sessions: request token missing.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Revoke refresh-token sessions before deletion. Already-issued access JWTs
    // remain cryptographically valid until exp; the UI does not promise otherwise.
    const { error: revokeError } = await supabaseAdmin.auth.admin.signOut(token, "global");
    if (revokeError) throw new Error(`Unable to revoke account sessions: ${revokeError.message}`);

    for (const table of USER_DELETE_TABLES) {
      const { error } = await supabaseAdmin.from(table).delete().eq("user_id", userId);
      if (error) throw new Error(`Unable to erase ${table}: ${error.message}`);
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error(deleteError.message);
    return { ok: true };
  });
