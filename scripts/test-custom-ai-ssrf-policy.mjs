import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBlockedIp, assertSafeApiUrl } from "../src/lib/ssrf.server.ts";

const guard = readFileSync(new URL("../src/lib/ssrf.server.ts", import.meta.url), "utf8");
const provider = readFileSync(new URL("../src/lib/ai-provider.server.ts", import.meta.url), "utf8");
assert.match(guard, /url\.protocol !== "https:"/);
assert.match(guard, /await lookup\(host, \{ all: true \}\)/);
assert.match(guard, /redirect: "manual"/);
assert.match(provider, /provider === "custom" \? publicOnlyFetch : fetch/);
assert.match(provider, /if \(provider === "custom"\) assertSafeApiUrl\(url\)/);

// Exercise the IP policy itself, not only source-code patterns.
for (const ip of [
  "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
  "172.16.0.1", "192.168.1.1", "192.88.99.1", "198.18.0.1",
  "192.0.2.1", "203.0.113.1", "224.0.0.1", "240.0.0.1",
  "::", "::1", "::8.8.8.8", "::808:808", "::ffff:192.168.1.1", "::ffff:c0a8:0101", "64:ff9b::a00:1", "2001:1::1",
  "2001:db8::1", "2002:0808:0808::1", "fc00::1", "fe80::1", "ff02::1",
]) {
  assert.equal(isBlockedIp(ip), true, `expected reserved/private IP to be blocked: ${ip}`);
}
for (const ip of ["8.8.8.8", "1.1.1.1", "::ffff:8.8.8.8", "::ffff:0808:0808", "2606:4700:4700::1111"]) {
  assert.equal(isBlockedIp(ip), false, `expected public IP to remain allowed: ${ip}`);
}
assert.throws(() => assertSafeApiUrl(new URL("http://example.com")), /HTTPS/);
assert.throws(() => assertSafeApiUrl(new URL("https://127.0.0.1")), /private/);
console.log("Custom AI provider SSRF behavioral and contract tests: PASS");
