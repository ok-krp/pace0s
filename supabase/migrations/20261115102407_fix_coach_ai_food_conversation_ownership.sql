CREATE OR REPLACE FUNCTION public.insert_coach_ai_food_idempotent_v2(p_user_id uuid, p_conversation_id uuid, p_tool_call_id text, p_name text, p_meal text, p_kcal numeric, p_protein_g numeric, p_carbs_g numeric, p_fat_g numeric, p_fiber_g numeric, p_sugar_g numeric, p_sodium_mg numeric, p_grams numeric, p_meta jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(id uuid, log_date date, inserted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text := p_conversation_id::text || ':' || p_tool_call_id;
  v_reserved uuid;
  v_id uuid;
  v_log_date date;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if p_conversation_id is null
     or p_tool_call_id is null
     or btrim(p_tool_call_id) = ''
     or length(p_tool_call_id) > 200 then
    raise exception 'invalid tool call context';
  end if;

  if not exists (
    select 1
    from public.ai_conversations c
    where c.id = p_conversation_id
      and c.user_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;

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

  update public.ai_tool_idempotency
  set food_log_id = v_id
  where idempotency_key = v_key;

  return query select v_id, v_log_date, true;
end;
$function$;
