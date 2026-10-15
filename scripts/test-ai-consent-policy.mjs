import assert from "node:assert/strict";
import fs from "node:fs";

const consent = fs.readFileSync("src/lib/ai-consent.server.ts", "utf8");
const chat = fs.readFileSync("src/lib/ai-chat.server.ts", "utf8");
const nutrition = fs.readFileSync("src/lib/nutrition-ai.functions.ts", "utf8");

assert.match(consent, /if \(granular\) return granular\.granted === true/);
assert.match(consent, /if \(granularError\)/);
assert.match(consent, /\.order\("decision_sequence", \{ ascending: false \}\)/);
assert.match(chat, /hasAiProcessingConsent\(client, userId\)/);
assert.match(chat, /ai_quota_exceeded/);
assert.match(nutrition, /hasAiProcessingConsent\(context\.supabase, context\.userId\)/);

console.log("AI consent revocation policy: PASS");
