import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/lib/legal.functions.ts", import.meta.url), "utf8");
assert.match(source, /const seenConsentTypes = new Set<string>\(\)/);
assert.match(source, /if \(seenConsentTypes\.has\(record\.consent_type\)\) continue/);
assert.match(source, /seenConsentTypes\.add\(record\.consent_type\)/);
assert.match(source, /opts\[key\] = record\.granted/);
assert.match(source, /typeof legacy\[key\] === "boolean" && !seenConsentTypes\.has\(key\)/);
console.log("Latest granular consent decision contract: PASS");
