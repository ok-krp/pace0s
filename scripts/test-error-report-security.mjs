import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const route = readFileSync(new URL("../src/routes/api/error-report.ts", import.meta.url), "utf8");
const limiter = readFileSync(new URL("../src/lib/rate-limit.ts", import.meta.url), "utf8");
assert.match(route, /readBoundedJson\(request, MAX_BODY_BYTES\)/);
assert.match(route, /rateLimit\(`error-report:/);
assert.match(route, /sameOrigin\(request\)/);
assert.match(limiter, /hits\.length >= limit/);
console.log("Error report bounded-body/rate-limit contract: PASS");
