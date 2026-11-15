import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const lock = readFileSync("bun.lock", "utf8");

function resolvedVersion(packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  const match = lock.match(new RegExp(`^\\s*"${escaped}": \\["${escaped}@([^"]+)"`, "m"));
  assert.ok(match, `Missing ${packageName} in bun.lock`);
  return match[1];
}

function atLeast(actual, minimum) {
  const a = actual.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  assert.equal(a.length, 3, `Unexpected version format: ${actual}`);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

const reactStart = resolvedVersion("@tanstack/react-start");
const serverCore = resolvedVersion("@tanstack/start-server-core");
assert.ok(atLeast(reactStart, "1.169.0"), `TanStack React Start must include the 1.169 validator API; found ${reactStart}`);
assert.ok(atLeast(serverCore, "1.169.43"), `TanStack server core is below the compatible patch floor; found ${serverCore}`);

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return /\\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const staleCalls = [];
for (const file of filesUnder("src")) {
  const source = readFileSync(file, "utf8");
  if (/\\.inputValidator\\s*\\(/.test(source)) staleCalls.push(file);
}
assert.deepEqual(staleCalls, [], `Removed TanStack .inputValidator() calls remain: ${staleCalls.join(", ")}`);

console.log(`TanStack SSR compatibility OK: react-start=${reactStart}, start-server-core=${serverCore}; no removed .inputValidator() calls.`);
