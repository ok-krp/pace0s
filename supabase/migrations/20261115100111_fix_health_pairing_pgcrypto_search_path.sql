-- SECURITY DEFINER functions pin search_path to the empty string.
-- pgcrypto is installed in schema extensions, so all pgcrypto functions must
-- use explicit schema qualification or PostgreSQL cannot resolve them.

create or replace function public.join_pairing_session(
  p_session_id uuid,
  p_secret_plaintext text,
  p_recipient_device_id uuid,
  p_ephemeral_pub jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.health_e2ee_pairing_sessions%rowtype;
  v_attempt integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_secret_plaintext is null
     or length(p_secret_plaintext) < 1
     or length(p_secret_plaintext) > 512 then
    raise exception 'Invalid session secret';
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
    raise exception 'Session expired';
  end if;

  if v_session.locked_until is not null and v_session.locked_until > now() then
    raise exception 'Session locked due to brute force protection';
  end if;

  if v_session.status <> 'pending' then
    raise exception 'Invalid state transition';
  end if;

  if encode(extensions.digest(convert_to(p_secret_plaintext, 'UTF8'), 'sha256'), 'hex')
       is distinct from v_session.secret_hash then
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

    -- Do not raise here: an uncaught exception would roll back attempt_count.
    return;
  end if;

  if jsonb_typeof(p_ephemeral_pub) <> 'object'
     or p_ephemeral_pub->>'kty' <> 'EC'
     or p_ephemeral_pub->>'crv' <> 'P-256'
     or coalesce(length(p_ephemeral_pub->>'x'), 0) <> 43
     or coalesce(length(p_ephemeral_pub->>'y'), 0) <> 43
     or coalesce(p_ephemeral_pub->>'x', '') !~ '^[A-Za-z0-9_-]{43}$'
     or coalesce(p_ephemeral_pub->>'y', '') !~ '^[A-Za-z0-9_-]{43}$' then
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
$$;

create or replace function public.complete_pairing_session(
  p_session_id uuid,
  p_recipient_device_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.health_e2ee_pairing_sessions%rowtype;
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
    raise exception 'Session expired';
  end if;

  update public.health_e2ee_pairing_sessions
  set status = 'completed',
      completed_at = now(),
      updated_at = now(),
      secret_hash = encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex')
  where id = p_session_id;
end;
$$;

revoke all on function public.join_pairing_session(uuid,text,uuid,jsonb) from public, anon;
grant execute on function public.join_pairing_session(uuid,text,uuid,jsonb) to authenticated;
revoke all on function public.complete_pairing_session(uuid,uuid) from public, anon;
grant execute on function public.complete_pairing_session(uuid,uuid) to authenticated;
