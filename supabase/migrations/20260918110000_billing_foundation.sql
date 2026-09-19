create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  plan text not null check (plan in ('free','plus','pro','coach')),
  status text not null check (status in ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists "billing_customers_select_own" on public.billing_customers;
create policy "billing_customers_select_own"
  on public.billing_customers for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "billing_subscriptions_select_own" on public.billing_subscriptions;
create policy "billing_subscriptions_select_own"
  on public.billing_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists billing_subscriptions_status_idx
  on public.billing_subscriptions(status);
create index if not exists billing_subscriptions_customer_idx
  on public.billing_subscriptions(stripe_customer_id);
