-- Compliance/security foundation: append-only audit + granular consent + account deletion requests.
-- This migration does NOT claim HIPAA applicability or implement client-side E2EE.
-- Existing plaintext health_samples remains a legacy table until clients are migrated.

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (length(action) between 1 and 160),
  resource text,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_user_created_idx
  on public.audit_log (user_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant insert on public.audit_log to authenticated;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

drop trigger if exists audit_log_no_mutation on public.audit_log;
create trigger audit_log_no_mutation
before update or delete on public.audit_log
for each row execute function public.prevent_audit_log_mutation();

revoke all on function public.prevent_audit_log_mutation() from public, anon, authenticated;

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (
    consent_type in ('health_data','health_cloud_sync','financial_data','ai_processing','marketing')
  ),
  granted boolean not null,
  legal_version text not null,
  policy_version text not null,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists consent_records_user_type_created_idx
  on public.consent_records (user_id, consent_type, created_at desc);

alter table public.consent_records enable row level security;
revoke all on public.consent_records from anon;
grant select, insert on public.consent_records to authenticated;

drop policy if exists consent_records_select_own on public.consent_records;
create policy consent_records_select_own
on public.consent_records for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists consent_records_insert_own on public.consent_records;
create policy consent_records_insert_own
on public.consent_records for insert
to authenticated
with check ((select auth.uid()) = user_id);

create or replace function public.prevent_consent_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'consent_records is append-only; record a new decision instead';
end;
$$;

drop trigger if exists consent_records_no_mutation on public.consent_records;
create trigger consent_records_no_mutation
before update or delete on public.consent_records
for each row execute function public.prevent_consent_mutation();

revoke all on function public.prevent_consent_mutation() from public, anon, authenticated;

create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'pending' check (
    status in ('pending','processing','completed','failed','canceled')
  ),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deletion_requests_user_created_idx
  on public.data_deletion_requests (user_id, created_at desc);

alter table public.data_deletion_requests enable row level security;
revoke all on public.data_deletion_requests from anon;
grant select, insert on public.data_deletion_requests to authenticated;

drop policy if exists deletion_requests_select_own on public.data_deletion_requests;
create policy deletion_requests_select_own
on public.data_deletion_requests for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists deletion_requests_insert_own on public.data_deletion_requests;
create policy deletion_requests_insert_own
on public.data_deletion_requests for insert
to authenticated
with check ((select auth.uid()) = user_id);

create or replace function public.set_deletion_request_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists deletion_requests_updated_at on public.data_deletion_requests;
create trigger deletion_requests_updated_at
before update on public.data_deletion_requests
for each row execute function public.set_deletion_request_updated_at();

revoke all on function public.set_deletion_request_updated_at() from public, anon, authenticated;

-- Remove accidental public-role policies on security-sensitive tables.
drop policy if exists ai_tool_idempotency_service_only on public.ai_tool_idempotency;
drop policy if exists sport_progression_targets_delete_own on public.sport_progression_targets;
drop policy if exists sport_progression_targets_insert_own on public.sport_progression_targets;
drop policy if exists sport_progression_targets_select_own on public.sport_progression_targets;
drop policy if exists sport_progression_targets_update_own on public.sport_progression_targets;

create policy sport_progression_targets_select_own
on public.sport_progression_targets for select
to authenticated
using ((select auth.uid()) = user_id);

create policy sport_progression_targets_insert_own
on public.sport_progression_targets for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.sport_exercises e
    where e.id = sport_progression_targets.exercise_id
      and e.user_id = (select auth.uid())
  )
);

create policy sport_progression_targets_update_own
on public.sport_progression_targets for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.sport_exercises e
    where e.id = sport_progression_targets.exercise_id
      and e.user_id = (select auth.uid())
  )
);

create policy sport_progression_targets_delete_own
on public.sport_progression_targets for delete
to authenticated
using ((select auth.uid()) = user_id);

-- ai_tool_idempotency is service-side state; deny direct client access.
alter table public.ai_tool_idempotency enable row level security;
revoke all on public.ai_tool_idempotency from anon, authenticated;

-- Billing events are webhook/service state; deny direct client access.
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

-- Provider secrets are server-side state; deny direct client access.
alter table public.ai_provider_secrets enable row level security;
revoke all on public.ai_provider_secrets from anon, authenticated;

comment on table public.health_samples is
'Legacy plaintext health storage. Do not extend for new HealthKit/Health Connect ingestion; migrate clients to encrypted-at-rest payloads before production health sync.';
