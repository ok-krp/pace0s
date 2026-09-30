-- The idempotency ledger is intentionally client-inaccessible. The RPC must therefore
-- run as its owner while still enforcing the caller's authenticated user_id.
create or replace function public.insert_coach_ai_food_idempotent_v2(
  p_user_id uuid,
  p_conversation_id uuid,
  p_tool_call_id text,
  p_name text,
  p_meal text,
  p_kcal numeric,
  p_protein_g numeric,
  p_carbs_g numeric,
  p_fat_g numeric,
  p_fiber_g numeric,
  p_sugar_g numeric,
  p_sodium_mg numeric,
  p_grams numeric,
  p_meta jsonb default null
)
returns table(id uuid, log_date date, inserted boolean)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_key text := p_conversation_id::text || ':' || p_tool_call_id;
  v_reserved uuid;
  v_id uuid;
  v_log_date date;
begin
  if p_user_id <> auth.uid() then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  insert into public.ai_tool_idempotency(idempotency_key, user_id, conversation_id, tool_name)
  values (v_key, p_user_id, p_conversation_id, 'add_food')
  on conflict (idempotency_key) do nothing;

  select food_log_id into v_reserved
  from public.ai_tool_idempotency
  where idempotency_key = v_key;

  if v_reserved is not null then
    select fl.id, fl.log_date into v_id, v_log_date
    from public.food_log fl
    where fl.id = v_reserved;
    if v_id is not null then
      return query select v_id, v_log_date, false;
      return;
    end if;
  end if;

  insert into public.food_log(
    user_id, name, meal, kcal, protein_g, carbs_g, fat_g,
    fiber_g, sugar_g, sodium_mg, source, meta
  )
  values (
    p_user_id, p_name || ' (' || round(p_grams)::text || ' g)', p_meal,
    p_kcal, p_protein_g, p_carbs_g, p_fat_g,
    p_fiber_g, p_sugar_g, p_sodium_mg, 'coach_ai', coalesce(p_meta, '{}'::jsonb)
  )
  returning food_log.id, food_log.log_date into v_id, v_log_date;

  update public.ai_tool_idempotency set food_log_id = v_id where idempotency_key = v_key;
  return query select v_id, v_log_date, true;
end;
$function$;

revoke execute on function public.insert_coach_ai_food_idempotent_v2(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) from anon;
grant execute on function public.insert_coach_ai_food_idempotent_v2(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) to authenticated;
revoke execute on function public.insert_coach_ai_food_idempotent_v2(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) from public;
grant execute on function public.insert_coach_ai_food_idempotent_v2(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) to authenticated;

-- Concurrent devices can update the nutrition state key with disjoint food IDs.
-- Merge that key on the server so a last-writer-wins JSON blob cannot erase
-- another device's additions.
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
  merged_day jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not authorized'; end if;
  if p_key is null or p_key = '' then raise exception 'key is required'; end if;
  if p_updated_by is null or pg_catalog.length(pg_catalog.trim(p_updated_by)) = 0 then raise exception 'updated_by is required'; end if;

  if p_key = 'pace.nutrition.items' then
    select us.value into current_value
    from public.user_state us
    where us.user_id = p_user_id and us.key = p_key;

    if jsonb_typeof(current_value) = 'object' and jsonb_typeof(p_value) = 'object' then
      for day_key in select key from pg_catalog.jsonb_object_keys(current_value) as key loop
        if jsonb_typeof(current_value -> day_key) = 'array' then
          if jsonb_typeof(p_value -> day_key) = 'array' then
            select coalesce(pg_catalog.jsonb_agg(item order by first_ord), '[]'::jsonb)
            into merged_day
            from (
              select distinct on (coalesce(item ->> 'id', item::text))
                item, ord as first_ord
              from (
                select value as item, ord, 0 as source
                from pg_catalog.jsonb_array_elements(current_value -> day_key) with ordinality
                union all
                select value as item, ord, 1 as source
                from pg_catalog.jsonb_array_elements(p_value -> day_key) with ordinality
              ) candidates
              order by coalesce(item ->> 'id', item::text), source desc, ord desc
            ) deduped;
            next_value := pg_catalog.jsonb_set(next_value, pg_catalog.array[day_key], merged_day, true);
          elsif p_value ? day_key then
            next_value := pg_catalog.jsonb_set(next_value, pg_catalog.array[day_key], current_value -> day_key, true);
          end if;
        end if;
      end loop;
      for day_key in select key from pg_catalog.jsonb_object_keys(p_value) as key loop
        if not (current_value ? day_key) then
          next_value := pg_catalog.jsonb_set(next_value, pg_catalog.array[day_key], p_value -> day_key, true);
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
