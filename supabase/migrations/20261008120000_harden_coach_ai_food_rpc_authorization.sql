-- Harden the privileged Coach AI food RPC against cross-user conversation IDs,
-- idempotency-ledger collisions, and search_path object-shadowing.
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
set search_path = ''
as $function$
declare
  v_key text := p_conversation_id::text || ':' || p_tool_call_id;
  v_reserved uuid;
  v_id uuid;
  v_log_date date;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if p_conversation_id is null or not exists (
    select 1
    from public.ai_conversations c
    where c.id = p_conversation_id
      and c.user_id = auth.uid()
  ) then
    raise exception 'conversation not owned by current user';
  end if;

  if p_tool_call_id is null
     or pg_catalog.length(pg_catalog.btrim(p_tool_call_id)) = 0
     or pg_catalog.length(p_tool_call_id) > 200 then
    raise exception 'invalid tool call id';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  insert into public.ai_tool_idempotency(idempotency_key, user_id, conversation_id, tool_name)
  values (v_key, p_user_id, p_conversation_id, 'add_food')
  on conflict (idempotency_key) do nothing;

  select i.food_log_id into v_reserved
  from public.ai_tool_idempotency i
  where i.idempotency_key = v_key
    and i.user_id = p_user_id
    and i.conversation_id = p_conversation_id
    and i.tool_name = 'add_food';

  if v_reserved is not null then
    select fl.id, fl.log_date into v_id, v_log_date
    from public.food_log fl
    where fl.id = v_reserved
      and fl.user_id = p_user_id;
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
    p_user_id, p_name || ' (' || pg_catalog.round(p_grams)::text || ' g)', p_meal,
    p_kcal, p_protein_g, p_carbs_g, p_fat_g,
    p_fiber_g, p_sugar_g, p_sodium_mg, 'coach_ai', coalesce(p_meta, '{}'::jsonb)
  )
  returning food_log.id, food_log.log_date into v_id, v_log_date;

  update public.ai_tool_idempotency
  set food_log_id = v_id
  where idempotency_key = v_key
    and user_id = p_user_id
    and conversation_id = p_conversation_id
    and tool_name = 'add_food';

  return query select v_id, v_log_date, true;
end;
$function$;

revoke execute on function public.insert_coach_ai_food_idempotent_v2(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) from anon;
grant execute on function public.insert_coach_ai_food_idempotent_v2(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) to authenticated;
revoke execute on function public.insert_coach_ai_food_idempotent_v2(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) from public;
