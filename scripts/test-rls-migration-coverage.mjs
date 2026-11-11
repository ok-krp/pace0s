import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20261108200000_rls_hardening_review.sql";
const sql = readFileSync(migrationPath, "utf8");

const directBlock = sql.match(/foreach t in array array\[([\s\S]*?)\]\s*loop/i)?.[1] ?? "";
const directUserTables = [...directBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);

const catalogBlock = sql.match(/grant select on table([\s\S]*?)to anon,\s*authenticated/i)?.[1] ?? "";
const catalogTables = [...catalogBlock.matchAll(/public\.([a-z0-9_]+)/gi)].map((match) => match[1]);

const childTables = [
  "ai_messages",
  "sport_program_items",
  "sport_workout_exercises",
  "sport_workout_sets",
].filter((table) => new RegExp(
  "grant select, insert, update, delete on public[.]" + table + " to authenticated",
  "i",
).test(sql));

const billingTables = sql.match(
  /grant select on public\.billing_customers,\s*public\.billing_subscriptions,\s*public\.billing_trials to authenticated/i,
) ? ["billing_customers", "billing_subscriptions", "billing_trials"] : [];

const consentTables = sql.match(
  /grant select on public\.consent_records to authenticated/i,
) && sql.match(
  /grant insert \(user_id, consent_type, granted, legal_version, policy_version\)\s+on public\.consent_records to authenticated/i,
) ? ["consent_records"] : [];

const deletionTables = sql.match(
  /grant select on public\.data_deletion_requests to authenticated/i,
) && sql.match(
  /grant insert \(user_id\) on public\.data_deletion_requests to authenticated/i,
) ? ["data_deletion_requests"] : [];

const readOnlyLogTables = sql.match(
  /grant select on public\.notification_log,\s*public\.reminder_debug_log to authenticated/i,
) ? ["notification_log", "reminder_debug_log"] : [];

const legacyHealthTables = sql.match(
  /grant select on public\.health_samples to authenticated/i,
) ? ["health_samples"] : [];

const e2eeTables = [
  "health_e2ee_devices",
  "user_biometrics_e2ee",
  "health_samples_e2ee",
  "health_e2ee_key_envelopes",
  "health_e2ee_key_versions",
  "health_e2ee_recovery_envelopes",
];

const backendOnlyTables = [
  "ai_provider_secrets",
  "ai_tool_idempotency",
  "audit_log",
  "billing_events",
];

const rpcOnlyTables = [
  "health_e2ee_pairing_sessions",
  "health_legacy_migration_map",
];

const classes = {
  directUserTables,
  ownerReadOnlyUserState: sql.match(/grant select on public\.user_state to authenticated/i) ? ["user_state"] : [],
  childTables,
  publicReadOnlyCatalogues: catalogTables,
  ownerReadOnlyBilling: billingTables,
  ownerReadInsertConsentRecords: consentTables,
  ownerReadInsertDeletionRequests: deletionTables,
  ownerReadOnlyLogs: readOnlyLogTables,
  legacyHealthReadOnly: legacyHealthTables,
  consentScopedE2eeTables: e2eeTables,
  backendOnlyTables,
  rpcOnlyTables,
};

const classified = Object.entries(classes).flatMap(([classification, tables]) =>
  tables.map((table) => ({ table, classification })),
);
const names = classified.map((item) => item.table);
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

assert.equal(directUserTables.length, 13, "Expected 13 direct user-owned CRUD tables");
assert.match(sql, /grant select on public\.legal_consent to authenticated/i,
  "Current legal document/options snapshot must remain readable by its owner");
assert.match(sql, /grant insert \(user_id, region, eula_version, privacy_version, ip_country, consented_at, opts\)[\s\S]*?on public\.legal_consent to authenticated/i,
  "Legal consent UPSERT may insert only app-submitted decision fields");
assert.match(sql, /grant update \(user_id, region, eula_version, privacy_version, ip_country, consented_at, opts\)[\s\S]*?on public\.legal_consent to authenticated/i,
  "Legal consent UPSERT may update only app-submitted decision fields");
assert.doesNotMatch(sql, /grant [^;]*delete[^;]*on public\.legal_consent/i,
  "Clients must not delete their legal consent snapshot");
const legalAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
for (const assertion of [
  "authenticated has broader-than-needed legacy legal consent privileges",
  "legacy legal consent UPSERT lost required column privileges",
  "legal consent owner UPSERT failed",
  "client deleted legal consent snapshot",
]) {
  assert.ok(legalAssertions.includes(assertion), "Missing legacy legal consent assertion: " + assertion);
}
assert.equal(classes.ownerReadOnlyUserState.length, 1, "user_state must be owner-readable but RPC-write-only");
assert.equal(childTables.length, 4, "Expected four child tables with parent ownership checks");
assert.equal(catalogTables.length, 6, "Expected six public read-only nutrition catalogues");
assert.equal(billingTables.length, 3, "Expected three owner-readable billing tables");
assert.equal(consentTables.length, 1, "Expected immutable consent records");
assert.equal(deletionTables.length, 1, "Expected deletion requests");
assert.equal(readOnlyLogTables.length, 2, "Expected two owner-readable, non-writable logs");
assert.equal(legacyHealthTables.length, 1, "Expected one read-only legacy health table");
assert.equal(e2eeTables.length, 6, "Expected six consent-scoped E2EE tables");
assert.equal(backendOnlyTables.length, 4, "Expected four service-only tables");
assert.equal(rpcOnlyTables.length, 2, "Expected two SECURITY DEFINER RPC-only tables");
assert.deepEqual(duplicates, [], "A public table must belong to exactly one access class");
assert.equal(names.length, 45, "Every audited public table must be classified");

const policyNames = [...sql.matchAll(/create policy\\s+([a-zA-Z0-9_]+)/gi)].map((match) => match[1]);
assert.deepEqual(
  policyNames.filter((name, index) => policyNames.indexOf(name) !== index),
  [],
  "A migration must not create the same policy name twice on the same target inventory",
);
assert.equal(new Set(names).size, 45, "The policy inventory must contain 45 unique tables");

const expectedPublicTables = [
  "ai_action_log","ai_conversations","ai_messages","ai_preferences",
  "ai_provider_secrets","ai_tool_idempotency","audit_log",
  "billing_customers","billing_events","billing_subscriptions","billing_trials",
  "consent_records","data_deletion_requests","development_tasks","food_log","food_scans",
  "health_e2ee_devices","health_e2ee_key_envelopes","health_e2ee_key_versions",
  "health_e2ee_pairing_sessions","health_e2ee_recovery_envelopes","health_legacy_migration_map",
  "health_samples","health_samples_e2ee","legal_consent","notification_log",
  "nutrition_canonical_dishes","nutrition_data_sources","nutrition_dish_references",
  "nutrition_reference_dishes","nutrition_reference_foods","nutrition_reference_sources",
  "profiles","push_subscriptions","reminder_debug_log","reminder_settings",
  "sport_exercises","sport_program_items","sport_programs","sport_progression_targets",
  "sport_workout_exercises","sport_workout_sets","sport_workout_sessions",
  "user_biometrics_e2ee","user_state",
].sort();
assert.deepEqual([...names].sort(), expectedPublicTables,
  "The RLS migration classifications must match the exact audited 45-table public schema");

const generatedTypes = readFileSync("src/integrations/supabase/types.ts", "utf8");
assert.match(generatedTypes, /has_current_health_e2ee_consent:\s*\{\s*Args:\s*never;\s*Returns:\s*boolean\s*\}/,
  "The exposed health consent RPC must be represented in the generated Supabase types");
assert.doesNotMatch(generatedTypes, /pace_private|owns_health_e2ee_pairing_session/,
  "The private policy helper must not be exposed in the generated Data API types");
assert.match(generatedTypes, /upsert_user_state_if_newer:/,
  "The monotonic user_state write RPC must remain part of the public app contract");

const aiConsent = readFileSync("src/lib/ai-chat.server.ts", "utf8");
const aiConsentInsert = aiConsent.match(
  /from\(["']consent_records["']\)\.insert\(\{[\s\S]*?\}\)/,
)?.[0] ?? "";
if (aiConsent.includes('.from("consent_records").insert(')) {
  assert.ok(aiConsentInsert.length > 0, "AI consent backfill insert must be detected");
  assert.doesNotMatch(aiConsentInsert, /created_at|\bid:/i,
    "AI consent backfill must not supply consent record IDs or timestamps");
}
assert.match(sql, /grant insert \(user_id, consent_type, granted, legal_version, policy_version\)[\s\S]*?on public\.consent_records to authenticated/i,
  "Consent clients must receive INSERT only on the five decision columns");
assert.match(sql, /created_at = \(select now\(\)\)/i,
  "Consent INSERT policy must require the database transaction timestamp");
assert.doesNotMatch(sql, /grant select, insert on public\.consent_records to authenticated/i,
  "Consent clients must not receive table-wide INSERT privileges");
const consentAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(consentAssertions, /client overrode consent record id\/timestamp/,
  "PostgreSQL integration tests must reject client-controlled consent metadata");
assert.match(consentAssertions, /database timestamp default not applied to consent records/,
  "PostgreSQL integration tests must prove database-generated consent timestamps");


const nonceAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
const definerHardeningSql = readFileSync(
  "supabase/migrations/20261111150000_harden_security_definer_routine_acl.sql", "utf8",
);
assert.match(definerHardeningSql, /revoke create on schema public from public, anon, authenticated/i,
  "PUBLIC and API roles must not create shadow objects in the exposed public schema");
const definerFunctions = [
  "sync_sport_user_state()",
  "delete_temporary_workout_after_finish()",
  "touch_ai_provider_secret_updated_at()",
  "prevent_audit_log_mutation()",
  "prevent_consent_mutation()",
  "set_deletion_request_updated_at()",
  "delete_user_data(uuid)",
  "sync_sport_program_archive_state()",
  "enforce_daily_nutrition_chat()",
];
const normalizedDefinerSql = definerHardeningSql.replace(/\s+/g, " ").toLowerCase();
for (const functionName of definerFunctions) {
  assert.ok(
    normalizedDefinerSql.includes(
      ("alter function public." + functionName + " set search_path = ''").toLowerCase(),
    ),
    "SECURITY DEFINER routine must use an empty search_path: " + functionName,
  );
}
assert.match(definerHardeningSql, /revoke all on function public\.sync_sport_user_state\(\)\s+from public, anon, authenticated/i,
  "Sport sync trigger function must not be directly callable by API roles");
assert.match(definerHardeningSql, /revoke all on function public\.delete_temporary_workout_after_finish\(\)\s+from public, anon, authenticated/i,
  "Temporary workout trigger function must not be directly callable by API roles");
assert.match(definerHardeningSql, /revoke all on function public\.delete_user_data\(uuid\)\s+from public, anon, authenticated, service_role/i,
  "Dormant destructive SECURITY DEFINER deletion helper must remain inaccessible until a caller is proven");
assert.match(definerHardeningSql, /grant execute on function public\.rotate_health_e2ee_key\(integer, uuid\)\s+to authenticated/i,
  "Key rotation RPC must remain available only to its intended authenticated caller");
assert.match(definerHardeningSql, /grant execute on function public\.upsert_user_state_if_newer\(uuid, text, jsonb, timestamptz, text\)\s+to authenticated/i,
  "Monotonic cloud-state RPC must remain available only to authenticated callers");
const definerWorkflow = readFileSync(".github/workflows/rls-postgres-preflight.yml", "utf8");
assert.match(definerWorkflow, /supabase\/migrations\/20261111150000_harden_security_definer_routine_acl\.sql/,
  "PostgreSQL preflight must apply existing definer-routine hardening");
const definerAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(definerAssertions, /existing SECURITY DEFINER routine does not have an empty search_path/,
  "PostgreSQL must inspect every hardened routine's stored search_path");
assert.match(definerAssertions, /trigger-only or dormant SECURITY DEFINER routine has unexpected API\/service EXECUTE/,
  "PostgreSQL must reject direct execution on trigger-only and dormant routines");
assert.match(definerAssertions, /owner workout UPDATE did not execute its protected trigger/,
  "A valid owner update must still invoke its trigger after EXECUTE is revoked");

const envelopeNonceMigration = readFileSync(
  "supabase/migrations/20261111140000_allow_nullable_health_e2ee_envelope_nonce.sql", "utf8",
);
assert.match(envelopeNonceMigration, /alter table public\.health_e2ee_key_envelopes\s+alter column nonce drop not null/i,
  "AES Key Wrap pairing requires a nullable nonce column");
assert.match(envelopeNonceMigration, /health_e2ee_key_envelopes_nonce_algorithm_check[\s\S]*?not valid/i,
  "The database must enforce the nonce contract for new rows without assuming historic rows are already clean");
const nonceTestBody = nonceAssertions.match(/DO \$envelope_nonce_contract\$[\s\S]*?\$envelope_nonce_contract\$;/)?.[0] ?? "";
assert.match(nonceTestBody, /AES-GCM envelope without a nonce unexpectedly succeeded/,
  "PostgreSQL must reject AES-GCM envelopes without a nonce");
assert.match(nonceTestBody, /AES Key Wrap envelope with a nonce unexpectedly succeeded/,
  "PostgreSQL must reject AES Key Wrap envelopes with a nonce");
const postgresWorkflow = readFileSync(".github/workflows/rls-postgres-preflight.yml", "utf8");
assert.match(postgresWorkflow, /supabase\/migrations\/20261111140000_allow_nullable_health_e2ee_envelope_nonce\.sql/,
  "PostgreSQL preflight must apply the E2EE nonce repair before envelope assertions");
assert.match(nonceAssertions, /AES Key Wrap envelope must accept NULL nonce/,
  "PostgreSQL must exercise the null-nonce AES Key Wrap case");
assert.match(nonceAssertions, /AES-GCM envelope must retain its nonce/,
  "PostgreSQL must preserve the required AES-GCM nonce case");
assert.match(sql, /health_e2ee_recovery_select_own/,
  "The same RLS suite must continue to cover consent-gated recovery envelopes");

const privacySource = readFileSync("src/lib/privacy.functions.ts", "utf8");
const privacyExportBlock = privacySource.match(/const EXPORT_TABLES = \[([\s\S]*?)\] as const/)?.[1] ?? "";
const privacyDeleteBlock = privacySource.match(/const DELETE_TABLES = \[([\s\S]*?)\] as const/)?.[1] ?? "";
for (const table of [
  "health_samples",
  "health_samples_e2ee",
  "user_biometrics_e2ee",
  "health_e2ee_devices",
  "health_e2ee_key_versions",
  "health_e2ee_key_envelopes",
  "health_e2ee_recovery_envelopes",
  "consent_records",
  "data_deletion_requests",
  "ai_action_log",
  "ai_conversations",
  "ai_messages",
  "ai_preferences",
  "development_tasks",
  "sport_programs",
  "sport_workout_sessions",
  "billing_customers",
  "billing_subscriptions",
  "billing_trials",
]) {
  assert.match(privacyExportBlock, new RegExp('"' + table + '"'),
    "Privacy export must include the authenticated user's " + table);
}
for (const table of [
  "health_samples",
  "health_samples_e2ee",
  "user_biometrics_e2ee",
  "health_e2ee_devices",
  "health_e2ee_key_versions",
  "health_e2ee_key_envelopes",
  "health_e2ee_pairing_sessions",
  "health_e2ee_recovery_envelopes",
  "health_legacy_migration_map",
  "ai_provider_secrets",
  "ai_tool_idempotency",
  "data_deletion_requests",
  "sport_programs",
  "sport_workout_sessions",
]) {
  assert.match(privacyDeleteBlock, new RegExp('"' + table + '"'),
    "Account deletion must clean up " + table);
}
assert.doesNotMatch(privacyExportBlock, /ai_provider_secrets|ai_tool_idempotency/,
  "Provider credentials and idempotency internals must never be included in a user export");
assert.doesNotMatch(privacyExportBlock, /health_legacy_migration_map|health_e2ee_pairing_sessions/,
  "RPC-only E2EE internals must not be exported through direct PostgREST access");
assert.match(privacySource, /const db = context\.supabase as any/,
  "Privacy export must execute through the authenticated client so RLS relationship checks remain active");
assert.match(privacySource, /db\.from\(table\)\.select\("\*"\)\.eq\("user_id", context\.userId\)/,
  "Admin-backed export must filter every owner table by the authenticated server context");
assert.match(privacySource, /\.from\("sport_program_items"\)[\s\S]*?\.in\("program_id", programIds\)/,
  "Sport program child rows must be exported through owner-derived program IDs");
assert.match(privacySource, /\.from\("sport_workout_exercises"\)[\s\S]*?\.in\("session_id", sessionIds\)/,
  "Sport workout exercises must be exported through owner-derived session IDs");
assert.match(privacySource, /\.from\("sport_workout_sets"\)[\s\S]*?\.in\("workout_exercise_id", exerciseIds\)/,
  "Sport workout sets must be exported through owner-derived exercise IDs");
assert.match(privacySource, /\.from\("sport_workout_sets"\)\.delete\(\)[\s\S]*?\.in\("workout_exercise_id", exerciseIds\)/,
  "Account deletion must remove Sport sets before exercises");
assert.match(privacySource, /\.from\("sport_program_items"\)\.delete\(\)[\s\S]*?\.in\("program_id", programIds\)/,
  "Account deletion must remove Sport program items before programs");
assert.match(privacySource, /for \(const table of DELETE_TABLES\)[\s\S]*?db\.from\(table\)\.delete\(\)\.eq\("user_id", userId\)/,
  "Account deletion must apply owner-scoped cleanup to the complete deletion allowlist");
assert.ok(privacySource.indexOf("for (const table of DELETE_TABLES)") < privacySource.indexOf("auth.admin.deleteUser(userId)"),
  "The auth user must not be deleted until all owned table cleanup has succeeded");

const aclAudit = readFileSync("scripts/rls-postgres-function-acl-audit.sql", "utf8");
assert.match(aclAudit, /has_function_privilege\('anon'/,
  "The read-only ACL inventory must report effective anonymous EXECUTE rights");
assert.match(aclAudit, /has_function_privilege\('authenticated'/,
  "The read-only ACL inventory must report effective authenticated EXECUTE rights");
assert.match(aclAudit, /explicit_public_execute/,
  "The read-only ACL inventory must report explicit PUBLIC EXECUTE grants");
assert.match(aclAudit, /pg_default_acl/,
  "The read-only ACL inventory must inspect defaults by object owner");
assert.match(aclAudit, /SECURITY DEFINER/,
  "The read-only ACL inventory must report SECURITY DEFINER routines");
assert.match(aclAudit, /has_schema_privilege\('anon',[\s\S]*?'CREATE'/,
  "The read-only ACL inventory must report whether anon can CREATE in exposed schemas");
assert.match(aclAudit, /has_schema_privilege\('authenticated',[\s\S]*?'CREATE'/,
  "The read-only ACL inventory must report whether authenticated can CREATE in exposed schemas");
assert.doesNotMatch(aclAudit, /^\s*(?:alter|create|drop|grant|revoke|insert|update|delete)\s/im,
  "The ACL inventory must remain read-only");

const assertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.ok(assertions.includes("anon unexpectedly read private profiles"),
  "Anonymous SELECT on private user data must be denied");
assert.ok(assertions.includes("profile owner reassignment unexpectedly succeeded"),
  "Authenticated users must not reassign profile ownership");
assert.ok(assertions.includes("user B profile isolation failed"),
  "A separate authenticated user B context must verify reverse tenant isolation");
assert.ok(assertions.includes("user B can read user A profile"),
  "User B must not read user A's profile");

assert.match(sql, /alter table %I\.%I enable row level security/i,
  "The migration must enable RLS for every public table");
assert.match(sql, /from pg_policies\s+where schemaname = 'public'/i,
  "Existing permissive policies must be removed before applying the reviewed policy set");
assert.match(sql, /drop policy %I on %I\.%I/i,
  "The migration must drop existing policies by their actual names");
assert.match(sql, /grant select on public\.user_state to authenticated/i,
  "user_state must remain owner-readable");
assert.match(sql, /create policy user_state_select_own on public\.user_state[\s\S]*?for select to authenticated/i,
  "user_state direct SELECT must be owner-isolated");
assert.doesNotMatch(sql, /grant [^;]*on public\.user_state to authenticated[^;]*(?:insert|update|delete)/i,
  "user_state writes must remain RPC-only");
const syncAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(syncAssertions, /user A can read user B user_state/,
  "PostgreSQL must verify user A cannot read user B cloud state");
assert.match(syncAssertions, /user B can read user A user_state/,
  "PostgreSQL must verify user B cannot read user A cloud state");
assert.doesNotMatch(directBlock, /'user_state'/,
  "user_state must not receive blanket CRUD privileges");

assert.match(sql, /revoke all privileges on all tables in schema public from anon, authenticated/i,
  "Existing API-role table grants must be removed before minimal grants are added");
assert.match(sql, /revoke all privileges \(%I\) on table %I\.%I from public, anon, authenticated/i,
  "Legacy column-level privileges must be removed separately from table-level grants");
const columnAclAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(columnAclAssertions, /legacy column-level grants survived the RLS privilege reset/,
  "PostgreSQL must verify that old column-only grants do not survive");
assert.match(sql, /revoke all privileges on schema public from anon, authenticated[\s\S]*?grant usage on schema public to anon, authenticated/i,
  "Schema usage must be re-established explicitly after revocation");
assert.match(sql, /alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated/i,
  "Future tables created by postgres must not inherit API-role table grants");
assert.match(sql, /alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated/i,
  "Future sequences created by postgres must not inherit API-role sequence grants");
assert.match(sql, /alter default privileges for role postgres revoke execute on functions from public/i,
  "Future functions created by postgres must not inherit the PostgreSQL PUBLIC EXECUTE grant");
assert.match(sql, /alter default privileges for role postgres in schema public revoke execute on functions from public/i,
  "Future public-schema functions created by postgres must not inherit schema-level PUBLIC EXECUTE grants");
assert.match(sql, /alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated/i,
  "Future public-schema functions created by postgres must not inherit API-role EXECUTE grants");
assert.match(sql, /alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated/i,
  "Future public tables created by postgres must not inherit direct API-role grants");
assert.match(sql, /alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated/i,
  "Future public sequences created by postgres must not inherit direct API-role grants");

for (const table of catalogTables) {
  assert.match(sql, new RegExp(
    "create policy " + table + "_read_catalog on public[.]" + table + "\\s+for select to anon, authenticated using [(]true[)]",
    "i",
  ), "Missing explicit public read-only policy for " + table);
}

for (const table of billingTables) {
  assert.match(sql, new RegExp(
    "create policy " + table + "_read_own on public[.]" + table + " for select to authenticated using [(]user_id = [(]select auth[.]uid[(][)][)][)]",
    "i",
  ), "Missing owner-only SELECT policy for " + table);
}

for (const table of consentTables) {
  assert.match(sql, /create policy consent_records_select_own[\s\S]*?for select to authenticated/i,
    "Consent records must be owner-readable");
  assert.match(sql, /create policy consent_records_insert_own[\s\S]*?for insert to authenticated/i,
    "Consent records must be owner-insert-only");
  assert.doesNotMatch(sql, /grant [^;]*on public\.consent_records to authenticated[^;]*update|grant [^;]*on public\.consent_records to authenticated[^;]*delete/i,
    "Consent records must not grant UPDATE or DELETE");
}

for (const table of legacyHealthTables) {
  assert.match(sql, /create policy health_samples_legacy_select_own[\s\S]*?for select to authenticated/i,
    "Legacy plaintext health rows must be owner-readable");
  assert.doesNotMatch(sql, /grant [^;]*on public\.health_samples to authenticated[^;]*(?:insert|update|delete)/i,
    "Legacy plaintext health rows must not grant writes");
}
assert.match(sql, /health_samples_legacy_select_own[\s\S]*?has_current_health_e2ee_consent/i,
  "Legacy plaintext health rows must require current granular health/cloud-sync consent");
const legacyHealthAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
for (const assertion of [
  "legacy health rows visible without consent",
  "legacy health owner read failed after required consent",
  "user B can read user A legacy health rows",
  "legacy health rows remain visible after consent revocation",
]) {
  assert.ok(legacyHealthAssertions.includes(assertion),
    "PostgreSQL must verify legacy health consent and isolation: " + assertion);
}

for (const table of readOnlyLogTables) {
  assert.match(sql, new RegExp(
    "create policy " + table + "_select_own on public[.]" + table + "\\s+for select to authenticated",
    "i",
  ), "Missing read-only owner policy for " + table);
  assert.doesNotMatch(sql, new RegExp(
    "grant [^;]*on public[.]" + table + " to authenticated[^;]*(?:insert|update|delete)",
    "i",
  ), table + " must not grant writes to authenticated");
}

assert.match(sql, /create or replace function public[.]has_current_health_e2ee_consent[(][)][\s\S]*?security invoker[\s\S]*?set search_path = ''/i,
  "The consent helper must be SECURITY INVOKER with an empty search_path");
assert.match(sql, /revoke all on function public[.]has_current_health_e2ee_consent[(][)] from public, anon, authenticated[\s\S]*?grant execute on function public[.]has_current_health_e2ee_consent[(][)] to authenticated/i,
  "The E2EE consent helper must be executable by authenticated users only");
const normalizedSql = sql.replace(/\s+/g, " ");
assert.equal(
  (normalizedSql.match(/order by c[.]created_at desc, c[.]id desc limit 1/gi) ?? []).length,
  2,
  "Each granular health consent must use a deterministic latest-decision order",
);

for (const table of e2eeTables) {
  assert.match(sql, new RegExp("public[.]" + table + "\\b", "i"),
    "Missing explicit handling for E2EE table " + table);
}
assert.match(sql, /health_samples_e2ee_update_own[\s\S]*?for update to authenticated/i,
  "Encrypted samples require owner-only UPDATE for conflict-safe upserts");
for (const operation of ["select", "insert", "update", "delete"]) {
  assert.match(sql, new RegExp(
    "create policy user_biometrics_e2ee_" + operation + "_own[\\s\\S]*?for " + operation +
      " to authenticated[\\s\\S]*?has_current_health_e2ee_consent",
    "i",
  ), "Encrypted biometrics require owner-scoped consent-gated " + operation);
}
assert.doesNotMatch(directBlock, /'user_biometrics_e2ee'/,
  "Encrypted biometrics must not receive generic CRUD policy grants");
const biometricAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
for (const assertion of [
  "E2EE biometrics visible without consent",
  "E2EE biometric write succeeded without required consent",
  "consented E2EE biometric rows are not owner-visible",
  "encrypted biometrics remain visible after consent revocation",
  "encrypted biometrics update succeeded after consent revocation",
  "encrypted biometrics insert succeeded after consent revocation",
  "user B can read user A E2EE biometrics",
]) {
  assert.ok(biometricAssertions.includes(assertion),
    "PostgreSQL must verify encrypted biometric consent/isolation: " + assertion);
}
assert.match(sql, /grant select on public\.health_e2ee_devices to authenticated/i,
  "Clients may list owned E2EE devices");
assert.match(sql, /grant insert \(user_id, device_name, public_key, algorithm\)[\s\S]*?on public\.health_e2ee_devices to authenticated/i,
  "Device registration may insert only owner identity and public key metadata");
assert.doesNotMatch(sql, /grant insert on public\.health_e2ee_devices to authenticated/i,
  "Device IDs, timestamps and revocation metadata must remain database-owned");
assert.doesNotMatch(sql, /grant [^;]*update[^;]*on public\.health_e2ee_devices|grant update on public\.health_e2ee_devices/i,
  "Clients must not directly update E2EE device revocation state");
assert.doesNotMatch(sql, /create policy health_e2ee_devices_update_own/i,
  "Device revocation must remain behind the key-rotation RPC");
const deviceAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(deviceAssertions, /authenticated can directly UPDATE device revocation state/,
  "PostgreSQL test must verify direct device UPDATE is denied");
assert.match(deviceAssertions, /client directly reactivated revoked E2EE device/,
  "PostgreSQL test must prove a revoked device cannot be reactivated by a client");
assert.match(deviceAssertions, /authenticated can choose E2EE device ID, timestamp or revocation state/,
  "PostgreSQL must prove device IDs, timestamps and revocation state are database-owned");
assert.match(sql, /grant insert \([\s\S]*?user_id, device_id, sender_device_id, pairing_session_id,[\s\S]*?envelope, nonce, algorithm, key_version[\s\S]*?\) on public\.health_e2ee_key_envelopes to authenticated/i,
  "Envelope INSERT must be column-scoped to data fields; IDs and timestamps stay database-generated");
assert.doesNotMatch(sql, /grant [^;]*delete[^;]*on public\.health_e2ee_key_envelopes/i,
  "Clients must not directly delete key envelopes");
const envelopeAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(envelopeAssertions, /authenticated can choose E2EE envelope ID or timestamp/,
  "PostgreSQL must verify E2EE envelope IDs/timestamps cannot be client-supplied");
assert.match(envelopeAssertions, /authenticated can directly delete E2EE key envelopes/,
  "PostgreSQL must verify key-envelope deletion is service-only");
const insertPolicy = sql.match(/create policy health_e2ee_envelopes_insert_own[\s\S]*?-- The current key version/i)?.[0] ?? "";
assert.match(insertPolicy, /device_id[\s\S]*?revoked_at is null/i,
  "Envelope recipient devices must be active at insertion time");
assert.match(insertPolicy, /sender_device_id[\s\S]*?revoked_at is null/i,
  "Envelope sender devices must be active at insertion time");
const e2eeAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(e2eeAssertions, /envelope for revoked recipient device unexpectedly succeeded/,
  "PostgreSQL tests must reject envelopes targeting revoked devices");
assert.match(e2eeAssertions, /envelope from revoked sender device unexpectedly succeeded/,
  "PostgreSQL tests must reject envelopes sent by revoked devices");
const consentGrantIndex = e2eeAssertions.indexOf("'health_cloud_sync',true");
const crossAccountEnvelopeIndex = e2eeAssertions.indexOf("cross-user pairing envelope INSERT");
const revokedRecipientIndex = e2eeAssertions.indexOf("envelope for revoked recipient device unexpectedly succeeded");
const revokedSenderIndex = e2eeAssertions.indexOf("envelope from revoked sender device unexpectedly succeeded");
assert.ok(consentGrantIndex >= 0 && crossAccountEnvelopeIndex > consentGrantIndex,
  "Cross-account pairing envelope policy must be tested after consent is granted");
assert.ok(consentGrantIndex >= 0 && revokedRecipientIndex > consentGrantIndex && revokedSenderIndex > consentGrantIndex,
  "Revoked-device checks must execute after consent is granted");
assert.match(sql, /health_e2ee_key_versions_select_own[\s\S]*?for select to authenticated/i,
  "Key versions must be read-only through direct API access");
assert.match(sql, /health_e2ee_recovery_select_own[\s\S]*?has_current_health_e2ee_consent/i,
  "Recovery envelopes must be readable only by their owner with current health/cloud-sync consent");
assert.match(sql, /health_e2ee_recovery_insert_own[\s\S]*?has_current_health_e2ee_consent/i,
  "Recovery envelopes must be insertable only with current health/cloud-sync consent");
assert.match(sql, /health_e2ee_recovery_update_own[\s\S]*?has_current_health_e2ee_consent/i,
  "Recovery envelopes must be updateable only with current health/cloud-sync consent");
assert.match(sql, /grant insert \(user_id, envelope, nonce, algorithm, key_version, updated_at\)[\s\S]*?on public\.health_e2ee_recovery_envelopes to authenticated/i,
  "Recovery UPSERT must have INSERT only on its explicit data fields");
assert.match(sql, /grant update \(envelope, nonce, algorithm, key_version, updated_at\)[\s\S]*?on public\.health_e2ee_recovery_envelopes to authenticated/i,
  "Recovery UPSERT must not update the owner or creation timestamp");
assert.doesNotMatch(sql, /grant select, insert, update on public\.health_e2ee_recovery_envelopes/i,
  "Recovery envelope privileges must not be table-wide");
assert.match(sql, /grant insert \(user_id\) on public\.data_deletion_requests to authenticated/i,
  "Users may submit a deletion request but cannot choose request metadata");
assert.doesNotMatch(sql, /grant select, insert on public\.data_deletion_requests/i,
  "Deletion request INSERT must not be table-wide");
const leastPrivilegeAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(leastPrivilegeAssertions, /authenticated has broader-than-needed E2EE recovery column privileges/,
  "PostgreSQL must assert recovery INSERT/UPDATE privileges are column-scoped");
assert.match(leastPrivilegeAssertions, /authenticated can control deletion request metadata/,
  "PostgreSQL must assert deletion request ID/status/timestamps are database-owned");
assert.match(leastPrivilegeAssertions, /owner could not submit a database-default pending deletion request/,
  "PostgreSQL must prove a valid owner can submit a default pending deletion request");
assert.doesNotMatch(directBlock, /'health_e2ee_recovery_envelopes'/,
  "Recovery envelopes must not receive generic owner CRUD grants");
assert.doesNotMatch(sql, /grant [^;]*delete[^;]*on public\.health_e2ee_recovery_envelopes/i,
  "Authenticated users must not directly delete recovery envelopes");
const recoveryAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
for (const assertion of [
  "E2EE recovery envelope visible without consent",
  "E2EE recovery write succeeded without required consent",
  "consented E2EE recovery envelope write failed",
  "user B can read user A E2EE recovery envelope",
  "recovery envelopes remain visible after consent revocation",
  "recovery envelope update succeeded after consent revocation",
  "recovery envelope insert succeeded after consent revocation",
]) {
  assert.ok(recoveryAssertions.includes(assertion), "Missing E2EE recovery consent test: " + assertion);
}

for (const table of backendOnlyTables) {
  assert.doesNotMatch(sql, new RegExp(
    "grant [^;]*public[.]" + table + "\\b[^;]*to (?:anon|authenticated)",
    "i",
  ), "Backend-only table " + table + " must not be granted to API roles");
  assert.match(sql, new RegExp(
    "create policy " + table + "_deny_client on public[.]" + table + "\\s+for all to anon, authenticated using [(]false[)] with check [(]false[)]",
    "i",
  ), "Backend-only table " + table + " must have an explicit deny policy");
}

for (const table of rpcOnlyTables) {
  assert.doesNotMatch(directBlock, new RegExp("'" + table + "'"), 
    "RPC-only table " + table + " must not receive blanket CRUD grants");
  assert.match(sql, new RegExp(
    "create policy " + table + "_deny_client on public[.]" + table + "\\s+for all to anon, authenticated using [(]false[)] with check [(]false[)]",
    "i",
  ), "RPC-only table " + table + " must have an explicit deny policy");
}
assert.match(sql, /create or replace function pace_private[.]owns_health_e2ee_pairing_session[(]p_session_id uuid[)][\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  "Pairing parent ownership must be checked through a hardened SECURITY DEFINER helper");
const pairingHelperIndex = sql.indexOf(
  "create or replace function pace_private.owns_health_e2ee_pairing_session",
);
const envelopePolicyIndex = sql.indexOf("create policy health_e2ee_envelopes_select_own");
assert.ok(
  pairingHelperIndex >= 0 && pairingHelperIndex < envelopePolicyIndex,
  "The private pairing ownership helper must exist before envelope policies reference it",
);
assert.match(sql, /revoke all on function pace_private[.]owns_health_e2ee_pairing_session[(]uuid[)] from public, anon, authenticated[\s\S]*?grant execute on function pace_private[.]owns_health_e2ee_pairing_session[(]uuid[)] to authenticated/i,
  "Pairing helper execution must be restricted to authenticated users");

for (const table of [
  "development_tasks",
  "sport_workout_sessions",
  "ai_action_log",
  "sport_progression_targets",
]) {
  assert.match(sql, new RegExp(
    "create policy " + table + "_user_isolation on public[.]" + table,
    "i",
  ), "Missing relationship-aware policy for " + table);
}

assert.doesNotMatch(sql, /ai_tool_idempotency_user_isolation|health_legacy_migration_map_user_isolation|health_e2ee_pairing_sessions_user_isolation/i,
  "Service/RPC-only tables must not regain direct user isolation policies");
assert.doesNotMatch(sql, /health_e2ee_key_envelopes_user_isolation/i,
  "The old broad envelope policy must not be recreated after consent-scoped E2EE policies");
assert.doesNotMatch(sql.slice(sql.indexOf("create policy health_e2ee_envelopes_select_own")),
  /from public[.]health_e2ee_pairing_sessions/i,
  "Envelope policies must not directly query the RPC-only pairing table");
assert.match(sql, /owns_health_e2ee_pairing_session\(pairing_session_id\)/i,
  "Envelope policies must validate pairing-session ownership without direct table access");

const dollarTags = [...sql.matchAll(/\$[A-Za-z_0-9]*\$/g)].map((match) => match[0]);
const dollarTagCounts = new Map();
for (const tag of dollarTags) dollarTagCounts.set(tag, (dollarTagCounts.get(tag) ?? 0) + 1);
assert.deepEqual(
  [...dollarTagCounts.entries()].filter(([, count]) => count % 2 !== 0),
  [],
  "Every SQL dollar-quote tag must have a matching closing delimiter",
);
assert.doesNotMatch(sql, /^\s*do\s+\$(?:\s|$)/im,
  "DO blocks must use complete dollar-quote delimiters");
assert.doesNotMatch(sql, /^\s*as\s+\$(?:\s|$)/im,
  "Function bodies must use complete dollar-quote delimiters");
assert.match(sql, /do \$drop_policy_cleanup\$[\s\S]*?end \$drop_policy_cleanup\$;/i,
  "The old-policy cleanup DO block must have a complete named delimiter");
assert.doesNotMatch(directBlock, /ai_provider_secrets|ai_tool_idempotency|consent_records|health_e2ee_devices|health_e2ee_key_envelopes|health_e2ee_key_versions|health_e2ee_pairing_sessions|health_samples_e2ee|health_legacy_migration_map|notification_log|reminder_debug_log/i,
  "Sensitive, consent-scoped, RPC-only, and read-only log tables must not receive blanket CRUD grants");

console.log("RLS migration coverage passed: all 45 public tables are classified with least-privilege access classes.");
