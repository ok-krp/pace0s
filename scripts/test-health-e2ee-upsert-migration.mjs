import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20261015123000_fix_health_e2ee_upsert_permissions.sql",
  "utf8",
);

assert.match(migration, /grant update on table public\.health_samples_e2ee to authenticated/i);
assert.match(migration, /create policy health_samples_e2ee_update_own[\s\S]*?for update[\s\S]*?to authenticated/i);
assert.match(migration, /using \([\s\S]*?auth\.uid\(\)[\s\S]*?user_id[\s\S]*?has_current_health_e2ee_consent\(\)/i);
assert.match(migration, /with check \([\s\S]*?auth\.uid\(\)[\s\S]*?user_id[\s\S]*?has_current_health_e2ee_consent\(\)/i);
assert.match(migration, /order by c\.created_at desc, c\.id desc/i);
console.log("health E2EE upsert migration contract: PASS");
