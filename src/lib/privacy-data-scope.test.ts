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
