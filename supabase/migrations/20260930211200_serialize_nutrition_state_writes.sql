-- Serialize per-user state writes so two devices cannot read the same stale nutrition blob and overwrite each other.
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
  current_value jsonb;
  next_value jsonb := p_value;
  day_key text;
  current_day jsonb;
  incoming_day jsonb;
  merged_day jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not authorized'; end if;
  if p_key is null or p_key = '' then raise exception 'key is required'; end if;
  if p_updated_by is null or pg_catalog.length(pg_catalog.trim(p_updated_by)) = 0 then raise exception 'updated_by is required'; end if;

  pg_catalog.perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || p_key, 0));

  if p_key = 'pace.nutrition.items' then
    select us.value into current_value
    from public.user_state us
    where us.user_id = p_user_id and us.key = p_key
    for update;

    if jsonb_typeof(current_value) = 'object' and jsonb_typeof(p_value) = 'object' then
      for day_key in
        select key from (
          select key from pg_catalog.jsonb_object_keys(current_value) as key
          union select key from pg_catalog.jsonb_object_keys(p_value) as key
        ) all_days
      loop
        current_day := current_value -> day_key;
        incoming_day := p_value -> day_key;
        if jsonb_typeof(current_day) = 'array' and jsonb_typeof(incoming_day) = 'array' then
          select coalesce(pg_catalog.jsonb_agg(item order by first_ord), '[]'::jsonb)
          into merged_day
          from (
            select distinct on (coalesce(item ->> 'id', item::text)) item, ord as first_ord
            from (
              select value as item, ord, 0 as source from pg_catalog.jsonb_array_elements(current_day) with ordinality
              union all
              select value as item, ord, 1 as source from pg_catalog.jsonb_array_elements(incoming_day) with ordinality
            ) candidates
            order by coalesce(item ->> 'id', item::text), source desc, ord desc
          ) deduped;
          next_value := pg_catalog.jsonb_set(next_value, pg_catalog.array[day_key], merged_day, true);
        elsif jsonb_typeof(current_day) = 'array' and incoming_day is null then
          next_value := pg_catalog.jsonb_set(next_value, pg_catalog.array[day_key], current_day, true);
        end if;
      end loop;
    end if;
  end if;

  insert into public.user_state (user_id, key, value, updated_at, updated_by)
  values (p_user_id, p_key, next_value, server_now, p_updated_by)
  on conflict (user_id, key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    where public.user_state.updated_at < excluded.updated_at
  returning updated_at into committed_at;

  if found then accepted := true;
  else
    select updated_at into committed_at from public.user_state where user_id = p_user_id and key = p_key;
  end if;

  return pg_catalog.jsonb_build_object('accepted', accepted, 'updated_at', committed_at);
end;
$function$;

revoke execute on function public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) from anon;
grant execute on function public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) to authenticated;
revoke execute on function public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) from public;
