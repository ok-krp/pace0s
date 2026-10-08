import assert from "node:assert/strict";
import fs from "node:fs";

const byokMigration = fs.readFileSync("supabase/migrations/20260821103000_ai_byok.sql", "utf8");
const coachFoodRpcMigration = fs.readFileSync(
  "supabase/migrations/20261008120000_harden_coach_ai_food_rpc_authorization.sql",
  "utf8",
);

for (const guard of [
  "REVOKE ALL ON TABLE public.ai_provider_secrets FROM anon, authenticated",
  "GRANT ALL ON TABLE public.ai_provider_secrets TO service_role",
  "encrypted_api_key",
]) {
  assert.ok(byokMigration.includes(guard), `BYOK database guard missing: ${guard}`);
}

for (const guard of [
  "p_user_id is distinct from auth.uid()",
  "conversation not owned by current user",
  "and i.user_id = p_user_id",
  "and fl.user_id = p_user_id",
  "set search_path = ''",
  "length(p_tool_call_id) > 200",
  "revoke all on function public.insert_coach_ai_food_idempotent(",
  "revoke execute on function public.insert_coach_ai_food_idempotent_v2",
  "grant execute on function public.insert_coach_ai_food_idempotent_v2",
]) {
  assert.ok(coachFoodRpcMigration.includes(guard), `Coach AI RPC guard missing: ${guard}`);
}

console.log("BYOK and Coach AI RPC security regression checks passed");
