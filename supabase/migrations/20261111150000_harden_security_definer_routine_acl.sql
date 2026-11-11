-- Harden active SECURITY DEFINER routines after the canonical application
-- migration chain has created them. Trigger functions need no direct EXECUTE
-- privilege for a row trigger to invoke them.
begin;

-- Do not let API roles or PUBLIC create shadow objects in the exposed schema.
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

-- User-state RPC: owner authorization is enforced inside the function body.
alter function public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  set search_path = '';
revoke all on function public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  to authenticated;

-- E2EE key rotation is a user RPC with auth.uid() and device-ownership checks.
alter function public.rotate_health_e2ee_key(integer, uuid)
  set search_path = '';
revoke all on function public.rotate_health_e2ee_key(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.rotate_health_e2ee_key(integer, uuid)
  to authenticated;

-- Trigger-only functions: PostgreSQL triggers invoke these without granting
-- EXECUTE to the role that caused the row event.
alter function public.sync_sport_user_state() set search_path = '';
revoke all on function public.sync_sport_user_state()
  from public, anon, authenticated;

alter function public.delete_temporary_workout_after_finish() set search_path = '';
revoke all on function public.delete_temporary_workout_after_finish()
  from public, anon, authenticated;

alter function public.touch_ai_provider_secret_updated_at() set search_path = '';
revoke all on function public.touch_ai_provider_secret_updated_at()
  from public, anon, authenticated;

alter function public.prevent_audit_log_mutation() set search_path = '';
revoke all on function public.prevent_audit_log_mutation()
  from public, anon, authenticated;

alter function public.prevent_consent_mutation() set search_path = '';
revoke all on function public.prevent_consent_mutation()
  from public, anon, authenticated;

alter function public.set_deletion_request_updated_at() set search_path = '';
revoke all on function public.set_deletion_request_updated_at()
  from public, anon, authenticated;

-- This legacy account-deletion helper has no tracked app callsite. Keep it
-- unavailable to all API roles until its intended service caller is proven.
alter function public.delete_user_data(uuid) set search_path = '';
revoke all on function public.delete_user_data(uuid)
  from public, anon, authenticated, service_role;

-- These existing trigger helpers already use an empty path in their source
-- migrations; repeat explicit execution revocations in the canonical hardening
-- pass so stale ACLs cannot survive a restored database.
alter function public.sync_sport_program_archive_state() set search_path = '';
revoke all on function public.sync_sport_program_archive_state()
  from public, anon, authenticated;

alter function public.enforce_daily_nutrition_chat() set search_path = '';
revoke all on function public.enforce_daily_nutrition_chat()
  from public, anon, authenticated;

commit;
