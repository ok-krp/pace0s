import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/lib/privacy.functions.ts", "utf8");
const helperStart = source.indexOf("async function listStorageObjectPaths");
const helperEnd = source.indexOf("const DELETE_TABLES", helperStart);
const helper = source.slice(helperStart, helperEnd);
const deletionHandler = source.slice(source.indexOf("export const deleteMyAccount"));

assert.ok(helperStart >= 0 && helperEnd > helperStart, "storage traversal helper must exist");
assert.match(helper, /offset \+= entries\.length/);
assert.match(helper, /entries\.length < pageSize/);
assert.match(helper, /entry\.id == null/);
assert.match(deletionHandler, /listStorageObjectPaths\(nutritionBucket, userId\)/);
assert.ok(
  deletionHandler.indexOf("nutritionBucket.remove") < deletionHandler.indexOf("for (const table of DELETE_TABLES)"),
  "storage cleanup must complete before SQL rows are deleted",
);
assert.match(deletionHandler, /remainingNutritionPaths/);
assert.match(deletionHandler, /remainingNutritionPaths\.length > 0/);

assert.ok(
  deletionHandler.indexOf("nutritionBucket.remove") < deletionHandler.indexOf("auth.admin.deleteUser"),
  "storage cleanup must complete before deleting the Auth user",
);
assert.match(source, /async function claimDeletionRequest/);
assert.match(source, /\.in\("status", \["pending", "processing"\]\)/);
assert.match(source, /\.eq\("status", "pending"\)/);
assert.match(deletionHandler, /claimDeletionRequest\(userId, supabaseAdmin\)/);

console.log("account deletion Storage cleanup contract: PASS");
