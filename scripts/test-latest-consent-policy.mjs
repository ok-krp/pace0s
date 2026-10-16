import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/lib/legal.functions.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261016180000_lock_down_consent_writes.sql", import.meta.url), "utf8");
assert.match(source, /const seenConsentTypes = new Set<string>\(\)/);
assert.match(source, /\.from\("legal_consent"\)\s*\.select\([^)]*\)\s*\.eq\("user_id", context\.userId\)/);
assert.match(source, /\.from\("consent_records"\)\s*\.select\([^)]*\)\s*\.eq\("user_id", context\.userId\)/);
assert.match(source, /if \(seenConsentTypes\.has\(record\.consent_type\)\) continue/);
assert.match(source, /seenConsentTypes\.add\(record\.consent_type\)/);
assert.match(source, /opts\[key\] = record\.granted/);
assert.match(source, /typeof legacy\[key\] === "boolean" && !seenConsentTypes\.has\(key\)/);
const granularWrite = source.indexOf('.from("consent_records").insert(records)');
const legacyWrite = source.indexOf('.from("legal_consent").upsert(');
assert.ok(
  granularWrite >= 0 && legacyWrite >= 0 && granularWrite < legacyWrite,
  "granular consent must be persisted before the legacy consent row",
);
assert.match(source, /supabaseAdmin\.from\("consent_records"\)\.insert\(records\)/);
assert.match(source, /supabaseAdmin\.from\("legal_consent"\)\.upsert\(/);
assert.match(migration, /REVOKE UPDATE, DELETE ON TABLE public\.consent_records FROM authenticated/);
assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.consent_records TO authenticated/);
assert.match(migration, /CREATE TRIGGER consent_records_force_created_at[\s\S]*?EXECUTE FUNCTION public\.enforce_consent_timestamps\(\)/);
assert.match(migration, /NEW\.created_at := now\(\)/);
assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.legal_consent FROM authenticated/);
assert.match(migration, /GRANT INSERT, UPDATE ON TABLE public\.legal_consent TO service_role/);

console.log("Latest consent order and server-only write contract: PASS");
