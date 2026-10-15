-- Server-enforced monthly quota for platform-provided cloud AI.
-- BYOK requests do not call this RPC; client-side counters are never authoritative.
create table if not exists public.ai_cloud_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null,
  actions_used integer not null default 0 check (actions_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month_start)
);

alter table public.ai_cloud_usage enable row level security;
revoke all on public.ai_cloud_usage from public, anon, authenticated;
grant all on public.ai_cloud_usage to service_role;

create or replace function public.consume_ai_cloud_action()
returns table (
  allowed boolean,
  used integer,
  monthly_limit integer,
  plan text,
  month_start date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan text;
  v_limit integer;
  v_month_start date := (date_trunc('month', now() at time zone 'UTC'))::date;
  v_used integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select subscription.plan
    into v_plan
    from public.billing_subscriptions subscription
    where subscription.user_id = v_user_id
      and subscription.status in ('active', 'trialing')
      and subscription.current_period_end is not null
      and subscription.current_period_end > now()
      and subscription.plan in ('plus', 'pro', 'coach')
    limit 1;

  v_limit := case v_plan
    when 'plus' then 60
    when 'pro' then 250
    when 'coach' then 750
    else 0
  end;

  if v_limit = 0 then
    return query select false, 0, 0, null::text, v_month_start;
    return;
  end if;

  insert into public.ai_cloud_usage as usage_row (user_id, month_start, actions_used, updated_at)
  values (v_user_id, v_month_start, 1, now())
  on conflict (user_id, month_start) do update
    set actions_used = usage_row.actions_used + 1,
        updated_at = now()
    where usage_row.actions_used < v_limit
  returning actions_used into v_used;

  if found then
    return query select true, v_used, v_limit, v_plan, v_month_start;
    return;
  end if;

  select usage_row.actions_used
    into v_used
    from public.ai_cloud_usage usage_row
    where usage_row.user_id = v_user_id
      and usage_row.month_start = v_month_start;

  return query select false, coalesce(v_used, v_limit), v_limit, v_plan, v_month_start;
end;
$$;

revoke all on function public.consume_ai_cloud_action() from public, anon;
grant execute on function public.consume_ai_cloud_action() to authenticated;
