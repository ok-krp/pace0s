import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/lib/legal.functions.ts", import.meta.url), "utf8");
assert.match(source, /const seenConsentTypes = new Set<string>\(\)/);
assert.match(source, /if \(seenConsentTypes\.has\(record\.consent_type\)\) continue/);
assert.match(source, /seenConsentTypes\.add\(record\.consent_type\)/);
assert.match(source, /opts\[key\] = record\.granted/);
assert.match(source, /typeof legacy\[key\] === "boolean" && !seenConsentTypes\.has\(key\)/);
const granularWrite = source.indexOf('.from("consent_records").insert(records)');
const legacyWrite = source.indexOf('.from("legal_consent").upsert(');
assert.ok(
  granularWrite >= 0 && legacyWrite >= 0 && granularWrite < legacyWrite,
  "granular consent must be persisted before the legacy consent row",
);
console.log("Latest granular consent and write-order contract: PASS");
