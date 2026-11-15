import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const lock = readFileSync("bun.lock", "utf8");

function resolvedVersion(packageName) {
  const prefix = '"' + packageName + '": ["' + packageName + "@";
  const line = lock.split(/\r?\n/).find((candidate) => candidate.trimStart().startsWith(prefix));
  assert.ok(line, "Missing " + packageName + " in bun.lock");
  const start = line.indexOf(prefix) + prefix.length;
  const end = line.indexOf('"', start);
  assert.ok(end > start, "Could not parse resolved version for " + packageName);
  return line.slice(start, end);
}

function atLeast(actual, minimum) {
  const a = actual.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  assert.equal(a.length, 3, "Unexpected version format: " + actual);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

const reactStart = resolvedVersion("@tanstack/react-start");
const serverCore = resolvedVersion("@tanstack/start-server-core");
assert.ok(atLeast(reactStart, "1.169.5"), "TanStack React Start must be >=1.169.5; found " + reactStart);
assert.ok(atLeast(serverCore, "1.169.43"), "TanStack server core must be >=1.169.43; found " + serverCore);

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    return [".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extension) ? [path] : [];
  });
}

const deprecatedApiReferences = [];
for (const file of filesUnder("src")) {
  const source = readFileSync(file, "utf8");
  if (source.includes(".inputValidator")) deprecatedApiReferences.push(file);
}
assert.deepEqual(deprecatedApiReferences, [], "Removed TanStack .inputValidator API remains in: " + deprecatedApiReferences.join(", "));

console.log("TanStack SSR compatibility OK: react-start=" + reactStart + ", start-server-core=" + serverCore + "; no removed .inputValidator API references.");
