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

-- Profile sync is the single insertion path; the function verifies auth.uid()
-- against p_user_id and preserves server-side newest-wins semantics.
alter function public.upsert_profile_if_newer(uuid, jsonb, timestamptz, text)
  security definer;
alter function public.upsert_profile_if_newer(uuid, jsonb, timestamptz, text)
  set search_path = '';
revoke all on function public.upsert_profile_if_newer(uuid, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.upsert_profile_if_newer(uuid, jsonb, timestamptz, text)
  to authenticated;

-- E2EE key rotation remains SECURITY DEFINER by design; its body explicitly
-- requires auth.uid(), validates sequential key versions, and checks device
-- ownership before revocation. Never grant EXECUTE to anon or PUBLIC.
alter function public.rotate_health_e2ee_key(integer, uuid)
  set search_path = '';
revoke all on function public.rotate_health_e2ee_key(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.rotate_health_e2ee_key(integer, uuid)
  to authenticated;

-- E2EE pairing functions are SECURITY DEFINER and validate auth.uid()
-- and device/session ownership internally. Revoke stale direct API grants
-- explicitly; the authenticated RPC calls are required by health.functions.ts.
alter function public.create_pairing_session(uuid,text,text,jsonb,integer) set search_path = '';
revoke all on function public.create_pairing_session(uuid,text,text,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.create_pairing_session(uuid,text,text,jsonb,integer)
  to authenticated;

alter function public.join_pairing_session(uuid,text,uuid,jsonb) set search_path = '';
revoke all on function public.join_pairing_session(uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.join_pairing_session(uuid,text,uuid,jsonb)
  to authenticated;

alter function public.confirm_pairing_session(uuid,uuid) set search_path = '';
revoke all on function public.confirm_pairing_session(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_pairing_session(uuid,uuid)
  to authenticated;

alter function public.complete_pairing_session(uuid,uuid) set search_path = '';
revoke all on function public.complete_pairing_session(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.complete_pairing_session(uuid,uuid)
  to authenticated;

alter function public.create_pairing_envelope(uuid,uuid,uuid,text,integer,text) set search_path = '';
revoke all on function public.create_pairing_envelope(uuid,uuid,uuid,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.create_pairing_envelope(uuid,uuid,uuid,text,integer,text)
  to authenticated;

alter function public.get_pairing_session(uuid) set search_path = '';
revoke all on function public.get_pairing_session(uuid)
  from public, anon, authenticated;
grant execute on function public.get_pairing_session(uuid)
  to authenticated;

-- The legacy Health migration RPC is called by the authenticated migration
-- flow and checks auth.uid() for every row it writes.
alter function public.migrate_health_legacy_chunk(jsonb) set search_path = '';
revoke all on function public.migrate_health_legacy_chunk(jsonb)
  from public, anon, authenticated;
grant execute on function public.migrate_health_legacy_chunk(jsonb)
  to authenticated;

-- Historical backfill RPC also checks auth.uid() and only updates the
-- caller's rows; keep the explicitly documented authenticated grant.
alter function public.backfill_health_e2ee_dedupe_hashes(jsonb) set search_path = '';
revoke all on function public.backfill_health_e2ee_dedupe_hashes(jsonb)
  from public, anon, authenticated;
grant execute on function public.backfill_health_e2ee_dedupe_hashes(jsonb)
  to authenticated;

-- The following Sport RPCs intentionally remain SECURITY INVOKER. Their
-- bodies fully qualify public tables and auth.uid(); an empty path removes
-- unnecessary name-resolution risk without bypassing table RLS.
alter function public.sport_update_exercise(uuid,text,text,text,text,integer,integer,numeric,integer)
  set search_path = '';
revoke all on function public.sport_update_exercise(uuid,text,text,text,text,integer,integer,numeric,integer)
  from public, anon, authenticated;
grant execute on function public.sport_update_exercise(uuid,text,text,text,text,integer,integer,numeric,integer)
  to authenticated;

alter function public.sport_delete_exercise(uuid) set search_path = '';
revoke all on function public.sport_delete_exercise(uuid) from public, anon, authenticated;
grant execute on function public.sport_delete_exercise(uuid) to authenticated;

alter function public.sport_update_program(uuid,text,text,integer[]) set search_path = '';
revoke all on function public.sport_update_program(uuid,text,text,integer[]) from public, anon, authenticated;
grant execute on function public.sport_update_program(uuid,text,text,integer[]) to authenticated;

alter function public.sport_delete_program(uuid) set search_path = '';
revoke all on function public.sport_delete_program(uuid) from public, anon, authenticated;
grant execute on function public.sport_delete_program(uuid) to authenticated;

alter function public.sport_finish_workout(uuid,timestamptz,integer,text) set search_path = '';
revoke all on function public.sport_finish_workout(uuid,timestamptz,integer,text) from public, anon, authenticated;
grant execute on function public.sport_finish_workout(uuid,timestamptz,integer,text) to authenticated;

alter function public.sport_delete_workout(uuid) set search_path = '';
revoke all on function public.sport_delete_workout(uuid) from public, anon, authenticated;
grant execute on function public.sport_delete_workout(uuid) to authenticated;

-- Consent is queried from RLS policies and remains an invoker function.
alter function public.has_current_health_e2ee_consent() set search_path = '';
revoke all on function public.has_current_health_e2ee_consent() from public, anon, authenticated;
grant execute on function public.has_current_health_e2ee_consent() to authenticated;

-- Timestamp helpers are trigger-only implementation details.
alter function public.touch_updated_at() set search_path = '';
revoke all on function public.touch_updated_at() from public, anon, authenticated;
alter function public.update_updated_at_column() set search_path = '';
revoke all on function public.update_updated_at_column() from public, anon, authenticated;

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
