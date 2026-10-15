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
assert.match(source, /tables\.sport_program_items = programItems/);
assert.match(source, /tables\.sport_workout_exercises = workoutExercises/);
assert.match(source, /tables\.sport_workout_sets = workoutSets/);
assert.match(source, /\.in\("program_id", programIds\)/);
assert.match(source, /\.in\("session_id", sessionIds\)/);
assert.match(source, /\.in\("workout_exercise_id", workoutExerciseIds\)/);
assert.match(source, /async function claimDeletionRequest/);
assert.match(source, /claim_account_deletion_request/);
const claimMigration = fs.readFileSync("supabase/migrations/20261015160000_account_deletion_claim_lock.sql", "utf8");
assert.match(claimMigration, /pg_advisory_xact_lock/);
assert.match(claimMigration, /status in \('pending', 'processing'\)/);
assert.match(claimMigration, /grant execute on function public\.claim_account_deletion_request\(uuid\) to service_role/i);
assert.match(deletionHandler, /claimDeletionRequest\(userId, supabaseAdmin\)/);

console.log("account deletion Storage cleanup contract: PASS");
