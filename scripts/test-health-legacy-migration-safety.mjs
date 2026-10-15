import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20261015130000_health_legacy_migration_safe_chunks.sql",
  "utf8",
);
const client = fs.readFileSync("src/lib/health.migration.ts", "utf8");

assert.match(migration, /auth\.uid\(\) <> p_expected_user_id/);
assert.match(migration, /has_current_health_e2ee_consent\(\)/);
assert.match(migration, /c\.legal_version = '2026-07-10'/i);
assert.match(migration, /c\.policy_version = '2026-07-10'/i);
assert.match(migration, /legacy\.id = legacy_id and legacy\.user_id = auth\.uid\(\)/);
assert.match(migration, /delete_migrated_health_legacy_chunk/);
assert.match(migration, /migration\.dedupe_hash/);
assert.match(migration, /encrypted\.dedupe_hash = migration\.dedupe_hash/);
assert.match(migration, /Unmapped dedupe collision requires payload verification/);
assert.match(migration, /Legacy mapping predates verified dedupe; reconciliation required/);
assert.match(migration, /revoke all on function public\.migrate_health_legacy_chunk\(jsonb\) from authenticated/i);

assert.match(client, /\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
assert.match(client, /\.order\("id", \{ ascending: true \}\)/);
assert.match(client, /assertSameAuthenticatedUser\(userId\)/);
assert.match(client, /migrate_health_legacy_chunk_for_user/);
assert.match(client, /delete_migrated_health_legacy_chunk/);
assert.match(client, /remainingCount/);
assert.doesNotMatch(client, /\.from\("health_samples"\)\.delete\(\)\.eq\("user_id", userId\)/);

console.log("health legacy migration safety contract: PASS");
