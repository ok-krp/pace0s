import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeInternalPath } from "../src/lib/safe-redirect.ts";

const redirect = readFileSync(new URL("../src/lib/safe-redirect.ts", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/routes/login.tsx", import.meta.url), "utf8");
assert.match(redirect, /value\.startsWith\("\/\/"\)/);
assert.match(redirect, /parsed\.origin !== "https:\/\/pace\.invalid"/);
assert.match(redirect, /decodeURIComponent\(parsed\.pathname\)/);
assert.match(login, /return safeInternalPath\(next, "\/"\)/);

assert.equal(safeInternalPath("/settings?tab=privacy"), "/settings?tab=privacy");
for (const path of ["/login", "/login/", "/login///?next=%2F", "/%6cogin", "/LOGIN?tab=1"]) {
  assert.equal(safeInternalPath(path, "/"), "/", `login-loop path should fall back: ${path}`);
}
for (const path of ["//evil.example", "https://evil.example", "/%zz", "/\\\\evil.example"]) {
  assert.equal(safeInternalPath(path, "/"), "/", `unsafe path should fall back: ${path}`);
}
console.log("Safe login redirect behavioral and contract tests: PASS");
