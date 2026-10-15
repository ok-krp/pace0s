import assert from "node:assert/strict";
import { resolveGranularConsentOptions } from "../src/lib/legal.ts";

const opts = resolveGranularConsentOptions([
  { consent_type: "health_data", granted: false, created_at: "2026-10-15T10:00:00Z" },
  { consent_type: "health_data", granted: true, created_at: "2026-10-14T10:00:00Z" },
  { consent_type: "health_cloud_sync", granted: true, created_at: "2026-10-15T09:00:00Z" },
  { consent_type: "unknown_category", granted: true, created_at: "2026-10-15T11:00:00Z" },
]);

assert.equal(opts.health_data, false, "a prior grant must not override a newer revocation");
assert.equal(opts.health_cloud_sync, true, "the newest grant should be honored");
assert.equal(opts.financial_data, false, "missing categories must fail closed");
assert.equal(opts.marketing, false, "unknown categories must not enable consent");
console.log("granular consent resolution: PASS");
