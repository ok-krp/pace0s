import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const redirect = readFileSync(new URL("../src/lib/safe-redirect.ts", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/routes/login.tsx", import.meta.url), "utf8");
assert.match(redirect, /value\.startsWith\("\/\/"\)/);
assert.match(redirect, /parsed\.origin !== "https:\/\/pace\.invalid"/);
assert.match(redirect, /parsed\.pathname === "\/login"/);
assert.match(login, /return safeInternalPath\(next, "\/"\)/);
console.log("Safe login redirect contract: PASS");
