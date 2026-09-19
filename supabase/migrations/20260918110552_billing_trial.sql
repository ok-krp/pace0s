create table if not exists public.billing_trials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_hash text not null unique,
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.billing_trials enable row level security;

drop policy if exists "billing_trials_select_own" on public.billing_trials;
create policy "billing_trials_select_own"
  on public.billing_trials for select to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists billing_trials_ends_idx
  on public.billing_trials(trial_ends_at);

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_plan_check;

alter table public.billing_subscriptions
  add constraint billing_subscriptions_plan_check
  check (plan in ('plus','pro','coach'));
