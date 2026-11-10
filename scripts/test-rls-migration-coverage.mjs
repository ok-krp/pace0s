import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20261108200000_rls_hardening_review.sql";
const sql = readFileSync(migrationPath, "utf8");

const directBlock = sql.match(/foreach t in array array\[([\s\S]*?)\]\s*loop/i)?.[1] ?? "";
const directUserTables = [...directBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);

const catalogBlock = sql.match(/grant select on table([\s\S]*?)to anon,\s*authenticated/i)?.[1] ?? "";
const catalogTables = [...catalogBlock.matchAll(/public\.([a-z0-9_]+)/gi)].map((match) => match[1]);

const childTables = [...sql.matchAll(
  /grant select,\s*insert,\s*update,\s*delete on public\.([a-z0-9_]+) to authenticated/gi,
)].map((match) => match[1]);

const billingTables = sql.match(
  /grant select on public\.billing_customers,\s*public\.billing_subscriptions,\s*public\.billing_trials to authenticated/i,
) ? ["billing_customers", "billing_subscriptions", "billing_trials"] : [];

const deletionTables = sql.includes(
  "grant select, insert on public.data_deletion_requests to authenticated",
) ? ["data_deletion_requests"] : [];

const backendOnlyTables = ["audit_log", "billing_events"];

const classes = {
  directUserTables,
  childTables,
  publicReadOnlyCatalogues: catalogTables,
  ownerReadOnlyBilling: billingTables,
  ownerSubmitReadOnlyDeletionRequests: deletionTables,
  backendOnlyTables,
};

const classified = Object.entries(classes).flatMap(([classification, tables]) =>
  tables.map((table) => ({ table, classification })),
);
const names = classified.map((item) => item.table);
const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);

assert.equal(directUserTables.length, 29, "Expected 29 direct user_id tables");
assert.equal(childTables.length, 4, "Expected four child tables with parent ownership checks");
assert.equal(catalogTables.length, 6, "Expected six public read-only nutrition catalogues");
assert.equal(billingTables.length, 3, "Expected three owner-readable billing tables");
assert.equal(deletionTables.length, 1, "Expected the deletion request table");
assert.equal(backendOnlyTables.length, 2, "Expected audit_log and billing_events as backend-only");
assert.deepEqual(duplicateNames, [], "A public table must belong to exactly one access class");
assert.equal(names.length, 45, "Every audited public table must be classified");
assert.equal(new Set(names).size, 45, "The policy inventory must contain 45 unique tables");

assert.match(sql, /alter table %I\.%I enable row level security/i,
  "The migration must enable RLS for every public table");
assert.match(sql, /revoke all privileges on all tables in schema public from anon, authenticated/i,
  "Existing API-role table grants must be removed before minimal grants are added");
assert.match(sql, /revoke all privileges on schema public from anon, authenticated[\s\S]*?grant usage on schema public to anon, authenticated/i,
  "Schema usage must be re-established explicitly after revocation");
assert.match(sql, /alter default privileges in schema public revoke all on tables from anon, authenticated/i,
  "Future tables must not inherit API-role table grants");
assert.match(sql, /alter default privileges in schema public revoke all on sequences from anon, authenticated/i,
  "Future sequences must not inherit API-role sequence grants");

for (const table of catalogTables) {
  assert.match(sql, new RegExp(
    "create policy " + table + "_read_catalog on public\\." + table + "\\s+for select to anon, authenticated using \\(true\\)",
    "i",
  ), "Missing explicit public read-only policy for " + table);
}

for (const table of billingTables) {
  assert.match(sql, new RegExp(
    "create policy " + table + "_read_own on public\\." + table + " for select to authenticated using \\(user_id = \\(select auth\\.uid\\(\\)\\)\\)",
    "i",
  ), "Missing owner-only SELECT policy for " + table);
}

for (const table of backendOnlyTables) {
  assert.doesNotMatch(sql, new RegExp(
    "grant [^;]*public\\." + table + "\\b[^;]*to (?:anon|authenticated)",
    "i",
  ), "Backend-only table " + table + " must not be granted to API roles");
}

for (const table of [
  "development_tasks",
  "sport_workout_sessions",
  "ai_action_log",
  "ai_tool_idempotency",
  "health_e2ee_key_envelopes",
  "health_e2ee_pairing_sessions",
  "sport_progression_targets",
  "health_legacy_migration_map",
]) {
  assert.match(sql, new RegExp(
    "create policy " + table + "_user_isolation on public\\." + table,
    "i",
  ), "Missing relationship-aware policy for " + table);
}

console.log("RLS migration coverage passed: 45/45 public tables are classified.");
