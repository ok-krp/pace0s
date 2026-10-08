import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = "supabase/migrations/20261008150000_least_privilege_client_table_grants.sql";
const sql = await readFile(path, "utf8");
const pairingPath = "supabase/migrations/20261008160000_require_consent_for_health_pairing_rpcs.sql";
const pairing = await readFile(pairingPath, "utf8");
const legacyPath = "supabase/migrations/20261008170000_prevent_cross_user_legacy_sample_claim.sql";
const legacy = await readFile(legacyPath, "utf8");

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS: ${message}`);
}

// The pairing migration is SQL-only and currently not applied in Supabase.
// Catch malformed dollar-quote terminators before a migration can reach a database.
check(!/^\$;$/m.test(pairing), "pairing RPC migration has no malformed $; terminators");
check((pairing.match(/^as \$\$$/gm) ?? []).length === (pairing.match(/^\$\$;$/gm) ?? []).length,
  "pairing RPC migration has balanced $$ function bodies");
check((pairing.match(/^create or replace function public\./gm) ?? []).length === 5,
  "pairing consent migration defines the five expected mutation RPCs");
check((pairing.match(/has_current_health_e2ee_consent\(\)/g) ?? []).length === 5,
  "all five pairing mutation RPCs require current health/cloud-sync consent");
check(!/^\$;$/m.test(legacy), "legacy ownership migration has no malformed $; terminators");
check((legacy.match(/^as \$\$/gm) ?? []).length === (legacy.match(/^\$\$;$/gm) ?? []).length,
  "legacy ownership migration has balanced $ function bodies");
check(/from public\.health_samples legacy[\s\S]*?legacy\.id = legacy_id[\s\S]*?legacy\.user_id = auth\.uid\(\)/i.test(legacy),
  "legacy migration verifies sample ownership before reserving its ID");
check(legacy.includes("Legacy sample does not belong to current user"),
  "cross-user legacy sample claims are rejected explicitly");

// Least privilege: remove existing and future client ACLs before explicit grants.
check(sql.includes("revoke all on all tables in schema public from anon;"), "revoke existing anon table privileges");
check(sql.includes("revoke all on all tables in schema public from authenticated;"), "revoke existing authenticated table privileges");
check(sql.includes("revoke all on all sequences in schema public from anon;"), "revoke existing anon sequence privileges");
check(sql.includes("revoke all on all sequences in schema public from authenticated;"), "revoke existing authenticated sequence privileges");

for (const owner of ["postgres", "supabase_admin"]) {
  check(sql.includes(`alter default privileges for role ${owner} in schema public`),
    `default ACLs are hardened for ${owner}`);
}
check(/revoke execute on functions from anon, authenticated;/i.test(sql),
  "future function EXECUTE defaults are revoked from client roles");

const unsafeTableGrants = sql.split(/\r?\n/).filter((line) =>
  /^\s*grant\b/i.test(line) &&
  /\bon\s+table\s+public\./i.test(line) &&
  /\b(truncate|trigger|references|maintain)\b/i.test(line)
);
check(unsafeTableGrants.length === 0, "no dangerous table privileges are granted to client roles");

const anonTableGrants = sql.split(/\r?\n/).filter((line) =>
  /^\s*grant\b/i.test(line) &&
  /\bon\s+table\s+public\./i.test(line) &&
  /\bto\s+anon\b/i.test(line)
);
check(anonTableGrants.length === 0, "no direct table grants are given to anon");

const serverOnlyNutrition = [
  "nutrition_canonical_dishes", "nutrition_data_sources", "nutrition_dish_references",
  "nutrition_reference_dishes", "nutrition_reference_foods", "nutrition_reference_sources"
];
for (const table of serverOnlyNutrition) {
  check(!new RegExp(`\\\\bgrant\\\\b[^;]*\\\\bon\\\\s+table\\\\s+public\\\\.${table}\\\\b`, "i").test(sql),
    `server-only nutrition table ${table} has no direct client grant`);
}

const expected = [
  "ai_messages", "ai_action_log", "health_e2ee_devices",
  "health_e2ee_key_envelopes", "health_samples_e2ee",
  "health_e2ee_key_versions", "health_e2ee_recovery_envelopes",
  "health_samples", "user_state"
];
for (const table of expected) {
  check(new RegExp(`\\bgrant\\b[^;]*\\bon\\s+table\\s+public\\.${table}\\b`, "i").test(sql),
    `explicit least-privilege grant exists for ${table}`);
}
