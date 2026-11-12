import { createServerFn } from "@tanstack/react-start";
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
  neq(column: string, value: string): PrivacyAdminSelectQuery;
  in(column: string, values: string[]): PrivacyAdminSelectQuery;
  order(column: string, options: { ascending: boolean }): PrivacyAdminSelectQuery;
  range(from: number, to: number): PrivacyAdminSelectQuery;
  limit(count: number): PrivacyAdminSelectQuery;
}

interface PrivacyAdminDeleteResponse {
  error: { message: string; code?: string } | null;
}

interface PrivacyAdminDeleteQuery extends PromiseLike<PrivacyAdminDeleteResponse> {
  eq(column: string, value: string): PrivacyAdminDeleteQuery;
  in(column: string, values: string[]): PrivacyAdminDeleteQuery;
}

interface PrivacyAdminQuery {
  select(columns: string): PrivacyAdminSelectQuery;
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

const PRIVACY_DELETE_PAGE_SIZE = 500;

async function readOwnedIds(
  adminData: PrivacyAdminDataClient,
  table: string,
  userId: string,
): Promise<string[]> {
  const rows = await collectUserExportPages(async (from, to) => {
    const { data, error } = await adminData
      .from(table)
      .select("id")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to);
    return { data, error };
  }, PRIVACY_DELETE_PAGE_SIZE);
  return stringIds(rows);
}

async function readChildIds(
  adminData: PrivacyAdminDataClient,
  table: string,
  parentColumn: string,
  parentIds: string[],
): Promise<string[]> {
  const result: string[] = [];
  for (let start = 0; start < parentIds.length; start += PRIVACY_DELETE_PAGE_SIZE) {
    const parentChunk = parentIds.slice(start, start + PRIVACY_DELETE_PAGE_SIZE);
    const rows = await collectUserExportPages(async (from, to) => {
      const { data, error } = await adminData
        .from(table)
        .select("id")
        .in(parentColumn, parentChunk)
        .order("id", { ascending: true })
        .range(from, to);
      return { data, error };
    }, PRIVACY_DELETE_PAGE_SIZE);
    result.push(...stringIds(rows));
  }
  return result;
}

async function deleteRowsByIds(
  adminData: PrivacyAdminDataClient,
  table: string,
  column: string,
  ids: string[],
): Promise<void> {
  for (let start = 0; start < ids.length; start += PRIVACY_DELETE_PAGE_SIZE) {
    const chunk = ids.slice(start, start + PRIVACY_DELETE_PAGE_SIZE);
    const { error } = await adminData.from(table).delete().in(column, chunk);
    if (error) throw new Error(`Unable to erase ${table}: ${error.message}`);
  }
}

/**
 * Check for user-owned sport catalog entries still referenced by another
 * account. Those references must be transferred/removed before account
 * deletion; no other user's workout or program data is rewritten.
 */
async function assertNoSharedSportReferences(
  adminData: PrivacyAdminDataClient,
  userId: string,
  programIds: string[],
  exerciseIds: string[],
): Promise<void> {
  const blockers: string[] = [];

  for (let start = 0; start < programIds.length; start += PRIVACY_DELETE_PAGE_SIZE) {
    const chunk = programIds.slice(start, start + PRIVACY_DELETE_PAGE_SIZE);
    const { data, error } = await adminData
      .from("sport_workout_sessions")
      .select("id")
      .in("program_id", chunk)
      .neq("user_id", userId)
      .limit(1);
    if (error) throw new Error(`Unable to verify shared sport programs: ${error.message}`);
    if (data?.length) blockers.push("programmes d'entraînement référencés par les séances d'un autre compte");
  }

  for (let start = 0; start < exerciseIds.length; start += PRIVACY_DELETE_PAGE_SIZE) {
    const chunk = exerciseIds.slice(start, start + PRIVACY_DELETE_PAGE_SIZE);
    const checks = await Promise.all([
      adminData
        .from("sport_program_items")
        .select("id,sport_programs!inner(user_id)")
        .in("exercise_id", chunk)
        .neq("sport_programs.user_id", userId)
        .limit(1),
      adminData
        .from("sport_workout_exercises")
        .select("id,sport_workout_sessions!inner(user_id)")
        .in("exercise_id", chunk)
        .neq("sport_workout_sessions.user_id", userId)
        .limit(1),
      adminData
        .from("sport_progression_targets")
        .select("id")
        .in("exercise_id", chunk)
        .neq("user_id", userId)
        .limit(1),
    ]);
    for (let i = 0; i < checks.length; i += 1) {
      const result = checks[i];
      if (result.error) {
        throw new Error(`Unable to verify shared sport exercises: ${result.error.message}`);
      }
      if (result.data?.length) {
        blockers.push("exercices personnels encore utilisés par les programmes, séances ou objectifs d'un autre compte");
      }
    }
  }

  if (blockers.length) {
    throw new Error(
      `Transférez ou supprimez d'abord les ressources sport partagées suivantes : ${[...new Set(blockers)].join(", ")}.`,
    );
  }
}

/**
 * Remove this account's sport child rows before its parent catalogue rows.
 * Two FKs to sport_exercises use ON DELETE RESTRICT, so relying only on
 * auth.users cascades can make account deletion fail based on trigger order.
 */
async function deleteOwnedSportChildren(
  adminData: PrivacyAdminDataClient,
  userId: string,
  programIds: string[],
  sessionIds: string[],
): Promise<void> {
  const workoutExerciseIds = await readChildIds(
    adminData,
    "sport_workout_exercises",
    "session_id",
    sessionIds,
  );
  await deleteRowsByIds(
    adminData,
    "sport_workout_sets",
    "workout_exercise_id",
    workoutExerciseIds,
  );
  await deleteRowsByIds(
    adminData,
    "sport_workout_exercises",
    "session_id",
    sessionIds,
  );
  await deleteRowsByIds(
    adminData,
    "sport_program_items",
    "program_id",
    programIds,
  );
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
        if (isMissingOptionalSchemaRelation(error.code)) continue;
        throw new Error(`Unable to verify shared resource ${guard.table}: ${error.message}`);
      }
      if (data?.length) blockers.push(guard.label);
    }
    if (blockers.length) {
      throw new Error(
        `Transférez ou supprimez d'abord les ressources partagées suivantes avant la suppression du compte : ${blockers.join(", ")}.`,
      );
    }

    // Sport exercises are referenced by RESTRICT FKs from program/workout
    // children. Check shared references before any personal data is purged,
    // then delete this user's child rows before deleting the parent catalogue.
    const [programIds, sessionIds, exerciseIds] = await Promise.all([
      readOwnedIds(adminData, "sport_programs", userId),
      readOwnedIds(adminData, "sport_workout_sessions", userId),
      readOwnedIds(adminData, "sport_exercises", userId),
    ]);
    await assertNoSharedSportReferences(adminData, userId, programIds, exerciseIds);

    // Keep the caller's session retryable until every personal table is purged.
    // Deleting the Auth user last revokes future refreshes without trapping the
    // user in a partially completed deletion if one table request fails.
    await deleteOwnedSportChildren(adminData, userId, programIds, sessionIds);

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
