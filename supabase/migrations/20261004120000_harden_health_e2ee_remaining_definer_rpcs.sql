-- Close consent gaps in remaining SECURITY DEFINER Health E2EE RPCs.
-- Pairing writes are already guarded by the pairing-table/envelope trigger.
-- Read-only pairing session access and key rotation must also honor the
-- current health + cloud-sync consent contract at the RPC boundary.

create or replace function public.get_pairing_session(
  p_session_id uuid
) returns table (
  id uuid,
  initiator_device_id uuid,
  recipient_device_id uuid,
  protocol_version text,
  status text,
  challenge text,
  initiator_ephemeral_public_key jsonb,
  recipient_ephemeral_public_key jsonb,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_current_health_e2ee_consent() then
    raise exception 'Health E2EE cloud-sync consent is required';
  end if;

  return query
  select
    s.id,
    s.initiator_device_id,
    s.recipient_device_id,
    s.protocol_version,
    s.status,
    s.challenge,
    s.initiator_ephemeral_public_key,
    s.recipient_ephemeral_public_key,
    s.expires_at
  from public.health_e2ee_pairing_sessions s
  where s.id = p_session_id
    and s.user_id = auth.uid()
    and s.status in ('pending','joined','confirmed');
end;
$$;

revoke all on function public.get_pairing_session(uuid) from public;
grant execute on function public.get_pairing_session(uuid) to authenticated;

create or replace function public.rotate_health_e2ee_key(
  p_new_key_version integer,
  p_revoked_device_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_current_health_e2ee_consent() then
    raise exception 'Health E2EE cloud-sync consent is required';
  end if;

  if p_new_key_version <= 1 then
    raise exception 'Invalid key version';
  end if;

  select current_key_version into current_version
  from public.health_e2ee_key_versions
  where user_id = auth.uid()
  for update;

  if current_version is null then
    current_version := 1;
    insert into public.health_e2ee_key_versions(user_id,current_key_version)
      values (auth.uid(),1)
      on conflict (user_id) do nothing;
  end if;

  if p_new_key_version <> current_version + 1 then
    raise exception 'Key version must advance exactly one step';
  end if;

  if p_revoked_device_id is not null then
    update public.health_e2ee_devices
      set revoked_at = coalesce(revoked_at, now())
      where id = p_revoked_device_id and user_id = auth.uid();
    if not found then
      raise exception 'Device does not belong to current user';
    end if;
  end if;

  update public.health_e2ee_key_versions
    set current_key_version = p_new_key_version, updated_at = now()
    where user_id = auth.uid();
end;
$$;

revoke all on function public.rotate_health_e2ee_key(integer,uuid) from public;
grant execute on function public.rotate_health_e2ee_key(integer,uuid) to authenticated;
