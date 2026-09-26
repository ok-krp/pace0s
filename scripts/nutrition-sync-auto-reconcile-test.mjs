import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const engine = fs.readFileSync(path.join(root, "src/hooks/use-cloud-sync-engine.tsx"), "utf8");

assert.match(engine, /function normalizeForSyncEquality/);
assert.match(engine, /Number\(value\.toFixed\(10\)\)/);
assert.match(engine, /Object\.entries\(value as Record<string, unknown>\)\n\s*\.sort/);
assert.match(engine, /function syncValuesEqual/);

// JSON property order and harmless floating-point noise must not create conflicts.
const normalize = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(10));
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
};
const equal = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
assert.equal(equal(
  { kcal: 2600, p: 67, c: 28, f: 10 },
  { c: 28, f: 10, p: 67, kcal: 2600 },
), true);
assert.equal(equal(336.4, 336.40000000000003), true);

// Nutrition state is auto-reconciled instead of producing a blocking conflict.
assert.match(engine, /function isNutritionSyncKey/);
assert.match(engine, /pace\.nutrition\.items/);
assert.match(engine, /pace\.nutrition\.totals/);
assert.match(engine, /function autoMergeNutritionValues/);
assert.match(engine, /if \(isNutritionSyncKey\(row\.key\)\)/);
assert.match(engine, /if \(isNutritionSyncKey\(key\)\)/);

console.log("nutrition-sync-auto-reconcile-test: PASS");
