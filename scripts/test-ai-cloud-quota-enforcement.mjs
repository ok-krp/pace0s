import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20261015150000_ai_cloud_monthly_quota.sql",
  "utf8",
);
const quotaHelper = fs.readFileSync("src/lib/ai-quota.server.ts", "utf8");
const chat = fs.readFileSync("src/lib/ai-chat.server.ts", "utf8");
const nutrition = fs.readFileSync("src/lib/nutrition-ai.functions.ts", "utf8");
const progression = fs.readFileSync("src/lib/sport-progression.server.ts", "utf8");

assert.match(migration, /primary key \(user_id, month_start\)/i);
assert.match(migration, /security definer[\s\S]*?set search_path = ''/i);
assert.match(migration, /status in \('active', 'trialing'\)/i);
assert.match(migration, /current_period_end > now\(\)/i);
assert.match(migration, /when 'trial' then 20/i);
assert.match(migration, /v_plan is null and not exists \([\s\S]*?from public\.billing_subscriptions existing/i);
assert.match(migration, /when 'plus' then 60/i);
assert.match(migration, /when 'pro' then 250/i);
assert.match(migration, /when 'coach' then 750/i);
assert.match(migration, /where usage_row[.]actions_used < v_limit/i);
assert.match(migration, /grant execute on function public\.consume_ai_cloud_action\(\) to authenticated/i);
assert.match(migration, /revoke all on public\.ai_cloud_usage from public, anon, authenticated/i);

assert.match(quotaHelper, /consume_ai_cloud_action/);
assert.match(quotaHelper, /AI_QUOTA_UNAVAILABLE/);
assert.match(chat, /runtime\.source === "pace"/);
assert.match(chat, /ai_quota_exceeded/);
assert.match(nutrition, /consumeCloudAiAction\(context\.supabase\)/);
assert.match(progression, /consumeCloudAiAction\(context\.supabase\)/);


const billingStatus = fs.readFileSync("src/lib/billing.functions.ts", "utf8");
const billingServer = fs.readFileSync("src/lib/billing.server.ts", "utf8");
assert.match(billingStatus, /ensureTrial\(context\.userId, data\.deviceId/);
assert.match(billingStatus, /trialActive/);
assert.match(billingServer, /PACE_TRIAL_HASH_SECRET/);
assert.doesNotMatch(billingServer, /pace-trial-salt/);

console.log("AI monthly quota and trial enforcement contract: PASS");
