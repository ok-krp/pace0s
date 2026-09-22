create table if not exists public.health_e2ee_pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  initiator_device_id uuid not null references public.health_e2ee_devices(id) on delete cascade,
  recipient_device_id uuid references public.health_e2ee_devices(id) on delete cascade,
  protocol_version text not null default 'pace-health-pairing-v1',
  status text not null default 'pending'
    check (status in ('pending','joined','confirmed','completed','rejected','expired','locked')),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  challenge text not null,
  initiator_ephemeral_public_key jsonb not null,
  recipient_ephemeral_public_key jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  locked_until timestamptz,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists health_e2ee_pairing_sessions_user_idx
  on public.health_e2ee_pairing_sessions(user_id);

create index if not exists health_e2ee_pairing_sessions_expiry_idx
  on public.health_e2ee_pairing_sessions(expires_at);

create unique index if not exists health_e2ee_pairing_sessions_active_initiator_uidx
  on public.health_e2ee_pairing_sessions(initiator_device_id)
  where status in ('pending','joined','confirmed');

alter table public.health_e2ee_pairing_sessions enable row level security;
revoke all on public.health_e2ee_pairing_sessions from anon, authenticated;

alter table public.health_e2ee_key_envelopes
  add column if not exists pairing_session_id uuid
  references public.health_e2ee_pairing_sessions(id)
  on delete set null;

create index if not exists health_e2ee_envelopes_pairing_session_idx
  on public.health_e2ee_key_envelopes(pairing_session_id);

create unique index if not exists health_e2ee_envelopes_pairing_version_uidx
  on public.health_e2ee_key_envelopes(pairing_session_id, device_id, key_version)
  where pairing_session_id is not null;

revoke all on function public.create_pairing_session(uuid,text,text,jsonb,integer) from public;
revoke all on function public.join_pairing_session(uuid,text,uuid,jsonb) from public;
revoke all on function public.confirm_pairing_session(uuid,uuid) from public;
revoke all on function public.complete_pairing_session(uuid,uuid) from public;

create or replace function public.create_pairing_session(
  p_initiator_device_id uuid,
  p_secret_hash text,
  p_challenge text,
  p_ephemeral_pub jsonb,
  p_expires_in_seconds integer default 300
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid pairing secret hash';
  end if;

  if p_expires_in_seconds < 60 or p_expires_in_seconds > 600 then
    raise exception 'Invalid pairing expiration';
  end if;

  if jsonb_typeof(p_ephemeral_pub) <> 'object'
     or p_ephemeral_pub->>'kty' <> 'EC'
     or p_ephemeral_pub->>'crv' <> 'P-256'
     or coalesce(length(p_ephemeral_pub->>'x'), 0) = 0
     or coalesce(length(p_ephemeral_pub->>'y'), 0) = 0 then
    raise exception 'Invalid initiator ephemeral public key';
  end if;

  if not exists (
    select 1
    from public.health_e2ee_devices d
    where d.id = p_initiator_device_id
      and d.user_id = auth.uid()
      and d.revoked_at is null
      and d.algorithm = 'ECDH-P256'
  ) then
    raise exception 'Unauthorized device';
  end if;

  insert into public.health_e2ee_pairing_sessions (
    user_id,
    initiator_device_id,
    secret_hash,
    challenge,
    initiator_ephemeral_public_key,
    expires_at
  )
  values (
    auth.uid(),
    p_initiator_device_id,
    p_secret_hash,
    p_challenge,
    p_ephemeral_pub,
    now() + make_interval(secs => p_expires_in_seconds)
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

grant execute on function public.create_pairing_session(uuid,text,text,jsonb,integer) to authenticated;

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

  if encode(digest(convert_to(p_secret_plaintext, 'UTF8'), 'sha256'), 'hex') <> v_session.secret_hash then
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
$$;

grant execute on function public.join_pairing_session(uuid,text,uuid,jsonb) to authenticated;

create or replace function public.confirm_pairing_session(
  p_session_id uuid,
  p_initiator_device_id uuid
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
    and initiator_device_id = p_initiator_device_id
  for update;

  if not found or v_session.status <> 'joined' then
    raise exception 'Invalid session or state';
  end if;

  if v_session.expires_at <= now() then
    update public.health_e2ee_pairing_sessions
    set status = 'expired', updated_at = now()
    where id = p_session_id;
    raise exception 'Session expired';
  end if;

  update public.health_e2ee_pairing_sessions
  set status = 'confirmed',
      confirmed_at = now(),
      updated_at = now()
  where id = p_session_id;
end;
$$;

grant execute on function public.confirm_pairing_session(uuid,uuid) to authenticated;

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
    update public.health_e2ee_pairing_sessions
    set status = 'expired', updated_at = now()
    where id = p_session_id;
    raise exception 'Session expired';
  end if;

  update public.health_e2ee_pairing_sessions
  set status = 'completed',
      completed_at = now(),
      updated_at = now(),
      secret_hash = encode(digest(gen_random_bytes(32), 'sha256'), 'hex')
  where id = p_session_id;
end;
$$;

grant execute on function public.complete_pairing_session(uuid,uuid) to authenticated;
