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
  /grant select, insert on public\.data_deletion_requests to authenticated/i,
) ? ["data_deletion_requests"] : [];

const readOnlyLogTables = sql.match(
  /grant select on public\.notification_log,\s*public\.reminder_debug_log to authenticated/i,
) ? ["notification_log", "reminder_debug_log"] : [];

const legacyHealthTables = sql.match(
  /grant select on public\.health_samples to authenticated/i,
) ? ["health_samples"] : [];

const e2eeTables = [
  "health_e2ee_devices",
  "health_samples_e2ee",
  "health_e2ee_key_envelopes",
  "health_e2ee_key_versions",
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

assert.equal(directUserTables.length, 16, "Expected 16 direct user-owned CRUD tables");
assert.equal(classes.ownerReadOnlyUserState.length, 1, "user_state must be owner-readable but RPC-write-only");
assert.equal(childTables.length, 4, "Expected four child tables with parent ownership checks");
assert.equal(catalogTables.length, 6, "Expected six public read-only nutrition catalogues");
assert.equal(billingTables.length, 3, "Expected three owner-readable billing tables");
assert.equal(consentTables.length, 1, "Expected immutable consent records");
assert.equal(deletionTables.length, 1, "Expected deletion requests");
assert.equal(readOnlyLogTables.length, 2, "Expected two owner-readable, non-writable logs");
assert.equal(legacyHealthTables.length, 1, "Expected one read-only legacy health table");
assert.equal(e2eeTables.length, 4, "Expected four consent-scoped E2EE tables");
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
assert.doesNotMatch(directBlock, /'user_state'/,
  "user_state must not receive blanket CRUD privileges");

assert.match(sql, /revoke all privileges on all tables in schema public from anon, authenticated/i,
  "Existing API-role table grants must be removed before minimal grants are added");
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

assert.match(sql, /create or replace function public[.]has_current_health_e2ee_consent[(][)]/,
  "The current health/cloud-sync consent helper must exist");
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
assert.match(sql, /grant select, insert on public\.health_e2ee_devices to authenticated/i,
  "Clients may register and list owned E2EE devices");
assert.doesNotMatch(sql, /grant [^;]*update[^;]*on public\.health_e2ee_devices|grant update on public\.health_e2ee_devices/i,
  "Clients must not directly update E2EE device revocation state");
assert.doesNotMatch(sql, /create policy health_e2ee_devices_update_own/i,
  "Device revocation must remain behind the key-rotation RPC");
const deviceAssertions = readFileSync("scripts/rls-postgres-assertions.sql", "utf8");
assert.match(deviceAssertions, /authenticated can directly UPDATE device revocation state/,
  "PostgreSQL test must verify direct device UPDATE is denied");
assert.match(deviceAssertions, /client directly reactivated revoked E2EE device/,
  "PostgreSQL test must prove a revoked device cannot be reactivated by a client");
assert.match(sql, /health_e2ee_envelopes_delete_own[\s\S]*?for delete to authenticated/i,
  "Envelopes must be deletable only by their owner");
const insertPolicy = sql.match(/create policy health_e2ee_envelopes_insert_own[\s\S]*?create policy health_e2ee_envelopes_delete_own/i)?.[0] ?? "";
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
