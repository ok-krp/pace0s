import test from "node:test";
import assert from "node:assert/strict";
import { USER_DELETE_TABLES, USER_EXPORT_TABLES } from "./privacy-data-scope.ts";

test("portable export includes core user-owned AI, sport, health and billing data", () => {
  for (const table of [
    "ai_conversations",
    "ai_messages",
    "ai_preferences",
    "development_tasks",
    "sport_workout_sessions",
    "sport_programs",
    "health_samples_e2ee",
    "health_e2ee_key_envelopes",
    "user_biometrics_e2ee",
    "billing_subscriptions",
    "consent_records",
    "user_state",
  ]) {
    assert.ok((USER_EXPORT_TABLES as readonly string[]).includes(table), table);
  }
});

test("portable export does not disclose server-side credentials or internal security records", () => {
  for (const table of [
    "ai_provider_secrets",
    "ai_tool_idempotency",
    "audit_log",
    "health_e2ee_pairing_sessions",
    "health_legacy_migration_map",
  ]) {
    assert.equal((USER_EXPORT_TABLES as readonly string[]).includes(table), false, table);
  }
});

test("account deletion explicitly removes legacy user-owned AI rows before deleting auth", () => {
  for (const table of [
    "ai_action_log",
    "ai_messages",
    "development_tasks",
    "ai_conversations",
    "ai_preferences",
    "ai_provider_secrets",
  ]) {
    assert.ok((USER_DELETE_TABLES as readonly string[]).includes(table), table);
  }
});

import {
  USER_EXPORT_ORDER_COLUMNS,
  USER_EXPORT_RELATIONS,
} from "./privacy-data-scope.ts";
import { collectUserExportPages, USER_EXPORT_PAGE_SIZE } from "./privacy-data-export.ts";

test("sport child records are exported through user-owned parent ids only", () => {
  assert.deepEqual(USER_EXPORT_RELATIONS.sport_program_items, {
    parent: "sport_programs",
    foreignKey: "program_id",
  });
  assert.deepEqual(USER_EXPORT_RELATIONS.sport_workout_exercises, {
    parent: "sport_workout_sessions",
    foreignKey: "session_id",
  });
  assert.deepEqual(USER_EXPORT_RELATIONS.sport_workout_sets, {
    parent: "sport_workout_exercises",
    foreignKey: "workout_exercise_id",
  });
  assert.equal(USER_EXPORT_ORDER_COLUMNS.ai_preferences, "user_id");
  assert.equal(USER_EXPORT_ORDER_COLUMNS.health_e2ee_key_versions, "user_id");
});

test("export pagination fetches every row beyond multiple server pages", async () => {
  const all = Array.from({ length: USER_EXPORT_PAGE_SIZE * 2 + 7 }, (_, i) => i);
  const fetchedRanges: Array<[number, number]> = [];
  const rows = await collectUserExportPages(async (from, to) => {
    fetchedRanges.push([from, to]);
    return { data: all.slice(from, to + 1), error: null };
  });
  assert.deepEqual(rows, all);
  assert.deepEqual(fetchedRanges, [
    [0, USER_EXPORT_PAGE_SIZE - 1],
    [USER_EXPORT_PAGE_SIZE, USER_EXPORT_PAGE_SIZE * 2 - 1],
    [USER_EXPORT_PAGE_SIZE * 2, USER_EXPORT_PAGE_SIZE * 3 - 1],
  ]);
});

test("export pagination handles empty and partial final pages", async () => {
  let calls = 0;
  const rows = await collectUserExportPages(async () => {
    calls += 1;
    return { data: calls === 1 ? ["a", "b"] : [], error: null };
  }, 2);
  assert.deepEqual(rows, ["a", "b"]);
  assert.equal(calls, 2);
});

test("export pagination fails closed on page errors and invalid sizes", async () => {
  await assert.rejects(
    collectUserExportPages(async () => ({ data: null, error: { message: "permission denied" } })),
    /permission denied/,
  );
  await assert.rejects(
    collectUserExportPages(async () => ({ data: [], error: null }), 0),
    RangeError,
  );
});

import {
  ACCOUNT_DELETE_SHARED_RESOURCE_GUARDS,
  isMissingOptionalWorkspaceRelation,
} from "./privacy-data-scope.ts";

test("account deletion protects shared workspace ownership and creator references", () => {
  assert.deepEqual(
    ACCOUNT_DELETE_SHARED_RESOURCE_GUARDS.map(({ table, column }) => [table, column]),
    [
      ["workspaces", "owner_user_id"],
      ["grocery_lists", "created_by"],
      ["grocery_list_items", "created_by"],
      ["pantry_items", "created_by"],
    ],
  );
});

test("only missing optional workspace relations are ignored on legacy schemas", () => {
  assert.equal(isMissingOptionalWorkspaceRelation("PGRST205"), true);
  assert.equal(isMissingOptionalWorkspaceRelation("42P01"), true);
  assert.equal(isMissingOptionalWorkspaceRelation("42501"), false);
  assert.equal(isMissingOptionalWorkspaceRelation("23503"), false);
});
