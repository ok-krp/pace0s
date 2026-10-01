create or replace function public.upsert_user_state_if_newer(
  p_user_id uuid,
  p_key text,
  p_value jsonb,
  p_updated_at timestamptz,
  p_updated_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  server_now timestamptz := pg_catalog.clock_timestamp();
  committed_at timestamptz;
  accepted boolean := false;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  if p_key is null or p_key = '' then
    raise exception 'key is required';
  end if;
  if p_updated_by is null or pg_catalog.length(pg_catalog.btrim(p_updated_by)) = 0 then
    raise exception 'updated_by is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_key, 0)
  );

  insert into public.user_state(user_id, key, value, updated_at, updated_by)
  values (p_user_id, p_key, p_value, server_now, p_updated_by)
  on conflict (user_id, key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    where public.user_state.updated_at < excluded.updated_at
  returning updated_at into committed_at;

  if found then
    accepted := true;
  else
    select updated_at
      into committed_at
      from public.user_state
     where user_id = p_user_id
       and key = p_key;
  end if;

  return pg_catalog.jsonb_build_object(
    'accepted', accepted,
    'updated_at', committed_at
  );
end;
$function$;

revoke execute on function public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text) from anon, public;
grant execute on function public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text) to authenticated;