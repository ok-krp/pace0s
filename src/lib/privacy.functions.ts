import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ACCOUNT_DELETE_SHARED_RESOURCE_GUARDS,
  USER_DELETE_TABLES,
  USER_EXPORT_ORDER_COLUMNS,
  USER_EXPORT_TABLES,
  OPTIONAL_USER_SCHEMA_TABLES,
  isMissingOptionalSchemaRelation,
} from "./privacy-data-scope";
import { collectUserExportPages } from "./privacy-data-export";

interface PrivacyExportQuery {
  select(columns: "*"): PrivacyExportQuery;
  eq(column: string, value: string): PrivacyExportQuery;
  in(column: string, values: string[]): PrivacyExportQuery;
  order(column: string, options: { ascending: boolean }): PrivacyExportQuery;
  range(from: number, to: number): Promise<{
    data: unknown[] | null;
    error: { message: string; code?: string } | null;
  }>;
}

interface PrivacyExportClient {
  from(table: string): PrivacyExportQuery;
}

interface PrivacyAdminResponse {
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
}

interface PrivacyAdminSelectQuery extends PromiseLike<PrivacyAdminResponse> {
  eq(column: string, value: string): PrivacyAdminSelectQuery;
  limit(count: number): PrivacyAdminSelectQuery;
}

interface PrivacyAdminDeleteResponse {
  error: { message: string; code?: string } | null;
}

interface PrivacyAdminDeleteQuery extends PromiseLike<PrivacyAdminDeleteResponse> {
  eq(column: "user_id", value: string): PrivacyAdminDeleteQuery;
}

interface PrivacyAdminQuery {
  select(columns: "id"): PrivacyAdminSelectQuery;
  delete(): PrivacyAdminDeleteQuery;
}

interface PrivacyAdminDataClient {
  from(table: string): PrivacyAdminQuery;
}

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
    // The export table names are a reviewed allowlist; use a narrow structural
    // interface because the generated Database union cannot model a dynamic table loop.
    const exportClient = context.supabase as unknown as PrivacyExportClient;
    for (const table of USER_EXPORT_TABLES) {
      const orderColumns = USER_EXPORT_ORDER_COLUMNS[table] ?? ["id"];
      tables[table] = await collectUserExportPages(async (from, to) => {
        const baseQuery = exportClient
          .from(table)
          .select("*")
          .eq("user_id", context.userId);
        const orderedQuery = orderColumns.reduce(
          (query, column) => query.order(column, { ascending: true }),
          baseQuery,
        );
        const { data, error } = await orderedQuery.range(from, to);
        if (
          error &&
          OPTIONAL_USER_SCHEMA_TABLES.has(table) &&
          isMissingOptionalSchemaRelation(error.code)
        ) {
          return { data: [], error: null };
        }
        return { data, error };
      });
    }

    const programIds = stringIds(tables.sport_programs ?? []);
    tables.sport_program_items = programIds.length
      ? await collectUserExportPages(async (from, to) => {
          const { data, error } = await exportClient
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
          const { data, error } = await exportClient
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
          const { data, error } = await exportClient
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
      schema_version: 3,
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
    const adminData = supabaseAdmin as unknown as PrivacyAdminDataClient;

    // Never cascade-delete shared workspaces or records created for other
    // members. These relations exist on the newer schema, but not the legacy
    // Vercel-bound source schema; only "relation missing" is safely ignored.
    const blockers: string[] = [];
    for (const guard of ACCOUNT_DELETE_SHARED_RESOURCE_GUARDS) {
      const { data, error } = await adminData
        .from(guard.table)
        .select("id")
        .eq(guard.column, userId)
        .limit(1);
      if (error) {
        if (isMissingOptionalWorkspaceRelation(error.code)) continue;
        throw new Error(`Unable to verify shared resource ${guard.table}: ${error.message}`);
      }
      if (data?.length) blockers.push(guard.label);
    }
    if (blockers.length) {
      throw new Error(
        `Transférez ou supprimez d'abord les ressources partagées suivantes avant la suppression du compte : ${blockers.join(", ")}.`,
      );
    }

    // Revoke refresh-token sessions before deletion. Already-issued access JWTs
    // remain cryptographically valid until exp; immediate JWT invalidation is not promised.
    const { error: revokeError } = await supabaseAdmin.auth.admin.signOut(token, "global");
    if (revokeError) throw new Error(`Unable to revoke account sessions: ${revokeError.message}`);

    for (const table of USER_DELETE_TABLES) {
      const { error } = await adminData.from(table).delete().eq("user_id", userId);
      if (error) {
        if (OPTIONAL_USER_SCHEMA_TABLES.has(table) && isMissingOptionalSchemaRelation(error.code)) {
          continue;
        }
        throw new Error(`Unable to erase ${table}: ${error.message}`);
      }
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error(deleteError.message);
    return { ok: true };
  });
