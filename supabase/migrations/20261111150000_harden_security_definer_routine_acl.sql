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

-- These two pairing RPCs call pgcrypto. Resolve the extension's actual schema
-- from pg_catalog instead of relying on an unqualified function lookup while
-- keeping search_path empty (legacy projects may have pgcrypto in public).
create or replace function public.join_pairing_session(
  p_session_id uuid,
  p_secret_plaintext text,
  p_recipient_device_id uuid,
  p_ephemeral_pub jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $
declare
  v_session public.health_e2ee_pairing_sessions%rowtype;
  v_attempt integer;
  v_pgcrypto_schema name;
  v_secret_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_session
  from public.health_e2ee_pairing_sessions
  where id = p_session_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_session.expires_at <= now() then
    update public.health_e2ee_pairing_sessions
    set status = 'expired', updated_at = now()
    where id = p_session_id
      and status not in ('completed','rejected');
    raise exception 'Session expired';
  end if;

  if v_session.locked_until is not null and v_session.locked_until > now() then
    raise exception 'Session locked due to brute force protection';
  end if;

  if v_session.status <> 'pending' then
    raise exception 'Invalid state transition';
  end if;

  select n.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto extension is not installed';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_secret_hash
  using p_secret_plaintext;

  if v_secret_hash <> v_session.secret_hash then
    v_attempt := v_session.attempt_count + 1;

    update public.health_e2ee_pairing_sessions
    set attempt_count = v_attempt,
        locked_until = case
          when v_attempt >= v_session.max_attempts then now() + interval '15 minutes'
          else null
        end,
        status = case
          when v_attempt >= v_session.max_attempts then 'locked'
          else status
        end,
        updated_at = now()
    where id = p_session_id;

    raise exception 'Invalid session secret';
  end if;

  if jsonb_typeof(p_ephemeral_pub) <> 'object'
     or p_ephemeral_pub->>'kty' <> 'EC'
     or p_ephemeral_pub->>'crv' <> 'P-256'
     or coalesce(length(p_ephemeral_pub->>'x'), 0) = 0
     or coalesce(length(p_ephemeral_pub->>'y'), 0) = 0 then
    raise exception 'Invalid recipient ephemeral public key';
  end if;

  if not exists (
    select 1
    from public.health_e2ee_devices d
    where d.id = p_recipient_device_id
      and d.user_id = auth.uid()
      and d.revoked_at is null
      and d.algorithm = 'ECDH-P256'
      and d.id <> v_session.initiator_device_id
  ) then
    raise exception 'Unauthorized recipient device';
  end if;

  update public.health_e2ee_pairing_sessions
  set status = 'joined',
      recipient_device_id = p_recipient_device_id,
      recipient_ephemeral_public_key = p_ephemeral_pub,
      updated_at = now()
  where id = p_session_id;
end;
$;

create or replace function public.complete_pairing_session(
  p_session_id uuid,
  p_recipient_device_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $
declare
  v_session public.health_e2ee_pairing_sessions%rowtype;
  v_pgcrypto_schema name;
  v_rotated_secret_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_session
  from public.health_e2ee_pairing_sessions
  where id = p_session_id
    and user_id = auth.uid()
    and recipient_device_id = p_recipient_device_id
  for update;

  if not found or v_session.status <> 'confirmed' then
    raise exception 'Invalid session or state';
  end if;

  if v_session.expires_at <= now() then
    update public.health_e2ee_pairing_sessions
    set status = 'expired', updated_at = now()
    where id = p_session_id;
    raise exception 'Session expired';
  end if;

  select n.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto extension is not installed';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(%I.gen_random_bytes(32), ''sha256''), ''hex'')',
    v_pgcrypto_schema,
    v_pgcrypto_schema
  )
  into v_rotated_secret_hash;

  update public.health_e2ee_pairing_sessions
  set status = 'completed',
      completed_at = now(),
      updated_at = now(),
      secret_hash = v_rotated_secret_hash
  where id = p_session_id;
end;
$;

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
