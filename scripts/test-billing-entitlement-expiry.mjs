import assert from "node:assert/strict";
import fs from "node:fs";
import { hasActivePaidEntitlement, planFromPriceId } from "../src/lib/billing.ts";

const now = Date.parse("2026-10-15T12:00:00.000Z");
const future = "2026-10-16T12:00:00.000Z";
const past = "2026-10-14T12:00:00.000Z";

assert.equal(hasActivePaidEntitlement("pro", "active", future, now), true);
assert.equal(hasActivePaidEntitlement("plus", "trialing", future, now), true);
assert.equal(hasActivePaidEntitlement("pro", "active", past, now), false);
assert.equal(hasActivePaidEntitlement("pro", "canceled", future, now), false);
assert.equal(hasActivePaidEntitlement("pro", "past_due", future, now), false);
assert.equal(hasActivePaidEntitlement("pro", "unpaid", future, now), false);
assert.equal(hasActivePaidEntitlement("pro", "incomplete", future, now), false);
assert.equal(hasActivePaidEntitlement("free", "active", future, now), false);
assert.equal(hasActivePaidEntitlement("pro", "active", null, now), false);
assert.equal(hasActivePaidEntitlement("pro", "active", "not-a-date", now), false);

process.env.STRIPE_PRICE_PLUS_MONTHLY = "price_plus_test";
process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_test";
process.env.STRIPE_PRICE_COACH_MONTHLY = "price_coach_test";
assert.equal(planFromPriceId("price_plus_test"), "plus");
assert.equal(planFromPriceId("price_pro_test"), "pro");
assert.equal(planFromPriceId("price_coach_test"), "coach");
assert.equal(planFromPriceId("price_unknown_test"), null);

// Guard the webhook entitlement source: unknown prices and conflicting
// metadata must fail closed, never silently grant the Plus tier.
const billingServer = fs.readFileSync("src/lib/billing.server.ts", "utf8");
assert.match(billingServer, /if \(!pricePlan\) throw new Error/);
assert.match(billingServer, /metadataPlan !== pricePlan/);
assert.match(billingServer, /const safePlan: PlanId = pricePlan/);
assert.doesNotMatch(billingServer, /plan && plan in PLAN_CATALOG \? plan : "plus"/);

console.log("billing entitlement and Stripe price policy: PASS");
