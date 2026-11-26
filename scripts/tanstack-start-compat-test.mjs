import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const lock = readFileSync("bun.lock", "utf8");

function resolvedVersions(packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp('\\["' + escaped + '@([0-9]+(?:\\.[0-9]+){2})"', "g");
  return [...new Set([...lock.matchAll(pattern)].map((match) => match[1]))];
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

function assertSingleVersion(packageName, minimum) {
  const versions = resolvedVersions(packageName);
  assert.equal(versions.length, 1, packageName + " must resolve to exactly one version; found: " + versions.join(", "));
  const version = versions[0];
  assert.ok(atLeast(version, minimum), packageName + " must be >= " + minimum + "; found " + version);
  return version;
}

const reactStart = assertSingleVersion("@tanstack/react-start", "1.169.5");
const reactRouter = assertSingleVersion("@tanstack/react-router", "1.170.46");
const routerCore = assertSingleVersion("@tanstack/router-core", "1.171.39");
const routerPlugin = assertSingleVersion("@tanstack/router-plugin", "1.169.0");
const serverCore = assertSingleVersion("@tanstack/start-server-core", "1.169.45");

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

console.log("TanStack SSR compatibility OK: react-start=" + reactStart + ", react-router=" + reactRouter + ", router-core=" + routerCore + ", router-plugin=" + routerPlugin + ", start-server-core=" + serverCore + "; no removed API references.");
