import assert from "node:assert/strict";
import fs from "node:fs";

const consent = fs.readFileSync("src/lib/ai-consent.server.ts", "utf8");
const chat = fs.readFileSync("src/lib/ai-chat.server.ts", "utf8");
const nutrition = fs.readFileSync("src/lib/nutrition-ai.functions.ts", "utf8");
const progression = fs.readFileSync("src/lib/sport-progression.server.ts", "utf8");
assert.match(progression, /hasAiProcessingConsent\(context\.supabase, context\.userId\)/);

const legalFunctions = fs.readFileSync("src/lib/legal.functions.ts", "utf8");
const atomicMigration = fs.readFileSync("supabase/migrations/20261015111500_atomic_legal_consent.sql", "utf8");

assert.match(consent, /if \(granular\) return granular\.granted === true/);
assert.match(consent, /if \(typeof opts\?\.ai_processing === "boolean"\) return opts\.ai_processing/);
assert.match(consent, /if \(granularError\)/);
assert.match(consent, /\.eq\("legal_version", LEGAL_VERSIONS\.eula\)/);
assert.match(consent, /\.eq\("policy_version", LEGAL_VERSIONS\.privacy\)/);
assert.match(consent, /\.order\("decision_sequence", \{ ascending: false \}\)/);
assert.match(chat, /hasAiProcessingConsent\(client, userId\)/);
assert.match(chat, /ai_quota_exceeded/);
assert.match(nutrition, /hasAiProcessingConsent\(context\.supabase, context\.userId\)/);
assert.match(legalFunctions, /rpc\(\s*"save_legal_consent_atomic"/);
assert.match(atomicMigration, /auth\.uid\(\) <> p_user_id/);
assert.match(atomicMigration, /insert into public\.consent_records/);
assert.doesNotMatch(legalFunctions, /\["analytics", "notifications", "sync_cloud", "ai", "marketing"\]/);


console.log("AI consent revocation policy: PASS");
