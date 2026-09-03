create table if not exists public.ai_tool_idempotency (
  idempotency_key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  tool_name text not null,
  food_log_id uuid null references public.food_log(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_tool_idempotency_user_created_idx
  on public.ai_tool_idempotency(user_id, created_at desc);

alter table public.ai_tool_idempotency enable row level security;

drop policy if exists ai_tool_idempotency_service_only on public.ai_tool_idempotency;
create policy ai_tool_idempotency_service_only
  on public.ai_tool_idempotency
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.insert_coach_ai_food_idempotent(
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
  p_grams numeric
)
returns table(id uuid, log_date date, inserted boolean)
language plpgsql
set search_path = public
as $$
declare
  v_key text := p_conversation_id::text || ':' || p_tool_call_id;
  v_reserved uuid;
  v_id uuid;
  v_log_date date;
begin
  if p_user_id <> auth.uid() then
    raise exception 'forbidden';
  end if;

  -- Serialize identical tool-call replays so two concurrent executions cannot
  -- both reserve the key before either one records the food row.
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
    fiber_g, sugar_g, sodium_mg, source
  )
  values (
    p_user_id, p_name || ' (' || round(p_grams)::text || ' g)', p_meal,
    p_kcal, p_protein_g, p_carbs_g, p_fat_g,
    p_fiber_g, p_sugar_g, p_sodium_mg, 'coach_ai'
  )
  returning food_log.id, food_log.log_date into v_id, v_log_date;

  update public.ai_tool_idempotency
  set food_log_id = v_id
  where idempotency_key = v_key;

  return query select v_id, v_log_date, true;
end;
$$;

grant execute on function public.insert_coach_ai_food_idempotent(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;
