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
console.log("Billing plan and customer/subscription persistence fail-closed contract: PASS");
