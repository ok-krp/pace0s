import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/billing.server.ts", import.meta.url), "utf8");

// Entitlements must be backed by a configured Stripe Price ID, never metadata alone.
assert.match(source, /const plan = planFromPriceId\(priceId\);/);
assert.doesNotMatch(source, /subscription\.metadata\?\.pace_plan\s*\?\?/);
assert.match(source, /if \(!plan \|\| !\(plan in PLAN_CATALOG\)\) throw new Error/);
assert.match(source, /const \{ error: subscriptionError \} = await supabase\.from\("billing_subscriptions"\)\.upsert/);
assert.match(source, /if \(subscriptionError\) throw new Error/);
assert.match(source, /if \(existingError\) throw new Error\("Impossible de vérifier le client de facturation\."\)/);

const trialBody = source.slice(
  source.indexOf("export async function ensureTrial"),
  source.indexOf("const checkoutSchema"),
);
assert.match(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source, /pace-trial-salt/);
assert.match(trialBody, /const \{ data: existing, error: existingError \} = await supabase/);
assert.match(trialBody, /if \(existingError\) throw new Error/);
assert.doesNotMatch(trialBody, /supabaseAdmin\.from\("billing_trials"\)/);
assert.match(trialBody, /if \(deviceError\) throw new Error/);
assert.match(trialBody, /if \(retryError\) throw new Error/);

console.log("Billing plan, trial fail-closed behavior, and customer/subscription persistence contract: PASS");
