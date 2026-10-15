import assert from "node:assert/strict";
import { hasActivePaidEntitlement } from "../src/lib/billing.ts";

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
console.log("billing entitlement expiry: PASS");
