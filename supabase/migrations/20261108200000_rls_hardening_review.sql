-- PaceOS RLS hardening (review/preflight migration)
-- Prepared from the read-only schema inventory of oqaqolvjxhrkvscsqhzp.
-- DO NOT apply to Production until data ownership/backfill and app tests pass.
-- Fail-closed baseline: no anonymous writes; authenticated rows are account-scoped.

begin;

-- 1) Enable RLS on every table currently in public (including future tables only
-- after explicit grants/policies are added; default privileges below stay closed).
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
  end loop;
end $$;

-- Remove all pre-existing permissive policies in public before creating the
-- reviewed policy set below. PostgreSQL ORs permissive policies together: a
-- stale permissive policy would otherwise bypass a newly-added restrictive one.
do $drop_policy_cleanup$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $drop_policy_cleanup$;

-- 2) Remove inherited API-role privileges. Service role remains owner/bypass-RLS.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
-- The audited schema has no public sequences. Do not grant sequence access globally.
-- Pin default-ACL changes to the PostgreSQL migration owner explicitly.
-- Supabase migrations are expected to run as postgres; never mutate a different
-- owner's defaults merely because the connection role changes in another env.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Supabase
-- also gives the API roles direct default EXECUTE grants in public. Close both
-- paths for functions created by postgres; each required RPC must explicitly
-- GRANT EXECUTE to its intended caller in its canonical migration.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- 3) Public, immutable nutrition/reference catalogues: read only.
grant select on table
  public.nutrition_canonical_dishes,
  public.nutrition_data_sources,
  public.nutrition_dish_references,
  public.nutrition_reference_dishes,
  public.nutrition_reference_foods,
  public.nutrition_reference_sources
to anon, authenticated;

-- RLS still applies after GRANT. Explicit read policies are required for the
-- six immutable reference tables; otherwise every SELECT is filtered out.
drop policy if exists nutrition_canonical_dishes_read_catalog on public.nutrition_canonical_dishes;
create policy nutrition_canonical_dishes_read_catalog on public.nutrition_canonical_dishes
  for select to anon, authenticated using (true);

drop policy if exists nutrition_data_sources_read_catalog on public.nutrition_data_sources;
create policy nutrition_data_sources_read_catalog on public.nutrition_data_sources
  for select to anon, authenticated using (true);

drop policy if exists nutrition_dish_references_read_catalog on public.nutrition_dish_references;
create policy nutrition_dish_references_read_catalog on public.nutrition_dish_references
  for select to anon, authenticated using (true);

drop policy if exists nutrition_reference_dishes_read_catalog on public.nutrition_reference_dishes;
create policy nutrition_reference_dishes_read_catalog on public.nutrition_reference_dishes
  for select to anon, authenticated using (true);

drop policy if exists nutrition_reference_foods_read_catalog on public.nutrition_reference_foods;
create policy nutrition_reference_foods_read_catalog on public.nutrition_reference_foods
  for select to anon, authenticated using (true);

drop policy if exists nutrition_reference_sources_read_catalog on public.nutrition_reference_sources;
create policy nutrition_reference_sources_read_catalog on public.nutrition_reference_sources
  for select to anon, authenticated using (true);

-- 4) Consent-scoped E2EE data and read-only user logs.
-- Keep this helper aligned with the canonical health/cloud-sync consent contract.
create or replace function public.has_current_health_e2ee_consent()
returns boolean
language sql
stable
security invoker
set search_path = public
as $health_consent$
  select
    coalesce((
    select c.granted
    from public.consent_records c
    where c.user_id = (select auth.uid())
      and c.consent_type = 'health_data'
    order by c.created_at desc, c.id desc
    limit 1
  ), false)
  and coalesce((
    select c.granted
    from public.consent_records c
    where c.user_id = (select auth.uid())
      and c.consent_type = 'health_cloud_sync'
    order by c.created_at desc, c.id desc
    limit 1
  ), false);
$health_consent$;
revoke all on function public.has_current_health_e2ee_consent() from public, anon, authenticated;
grant execute on function public.has_current_health_e2ee_consent() to authenticated;

-- Encrypted health samples can be read, inserted, updated for conflict-safe
-- upserts, or deleted only by their owner while both required consents are live.
grant select, insert, update, delete on public.health_samples_e2ee to authenticated;
create policy health_samples_e2ee_select_own on public.health_samples_e2ee
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()));
create policy health_samples_e2ee_insert_own on public.health_samples_e2ee
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()));
create policy health_samples_e2ee_update_own on public.health_samples_e2ee
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()))
  with check (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()));
create policy health_samples_e2ee_delete_own on public.health_samples_e2ee
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()));

-- Devices are user-managed but cannot be physically deleted through the API;
-- revocation uses revoked_at and remains consent-gated.
grant select, insert, update on public.health_e2ee_devices to authenticated;
create policy health_e2ee_devices_select_own on public.health_e2ee_devices
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()));
create policy health_e2ee_devices_insert_own on public.health_e2ee_devices
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()));
create policy health_e2ee_devices_update_own on public.health_e2ee_devices
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()))
  with check (user_id = (select auth.uid()) and (select public.has_current_health_e2ee_consent()));

-- Keep the policy-only SECURITY DEFINER helper outside the exposed public schema.
-- The schema is not added to the Data API exposed-schema list; authenticated
-- receives only USAGE plus EXECUTE on this one ownership predicate.
create schema if not exists pace_private;
revoke all on schema pace_private from public, anon, authenticated;
grant usage on schema pace_private to authenticated;

create or replace function pace_private.owns_health_e2ee_pairing_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $owns_pairing_session$
  select exists (
    select 1
    from public.health_e2ee_pairing_sessions s
    where s.id = p_session_id
      and s.user_id = auth.uid()
  );
$owns_pairing_session$;
revoke all on function pace_private.owns_health_e2ee_pairing_session(uuid) from public, anon, authenticated;
grant execute on function pace_private.owns_health_e2ee_pairing_session(uuid) to authenticated;

-- Key envelopes are immutable: owner SELECT/INSERT/DELETE only, with every
-- referenced device/session checked against the same account.
grant select, insert, delete on public.health_e2ee_key_envelopes to authenticated;
create policy health_e2ee_envelopes_select_own on public.health_e2ee_key_envelopes
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.has_current_health_e2ee_consent())
    and exists (select 1 from public.health_e2ee_devices d
                where d.id = health_e2ee_key_envelopes.device_id and d.user_id = (select auth.uid()))
    and (sender_device_id is null or exists (
      select 1 from public.health_e2ee_devices d
      where d.id = health_e2ee_key_envelopes.sender_device_id and d.user_id = (select auth.uid())
    ))
    and (pairing_session_id is null or pace_private.owns_health_e2ee_pairing_session(pairing_session_id))
  );
create policy health_e2ee_envelopes_insert_own on public.health_e2ee_key_envelopes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.has_current_health_e2ee_consent())
    and exists (select 1 from public.health_e2ee_devices d
                where d.id = health_e2ee_key_envelopes.device_id and d.user_id = (select auth.uid()))
    and (sender_device_id is null or exists (
      select 1 from public.health_e2ee_devices d
      where d.id = health_e2ee_key_envelopes.sender_device_id and d.user_id = (select auth.uid())
    ))
    and (pairing_session_id is null or pace_private.owns_health_e2ee_pairing_session(pairing_session_id))
  );
create policy health_e2ee_envelopes_delete_own on public.health_e2ee_key_envelopes
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.has_current_health_e2ee_consent())
    and exists (select 1 from public.health_e2ee_devices d
                where d.id = health_e2ee_key_envelopes.device_id and d.user_id = (select auth.uid()))
  );

-- The current key version is readable directly; writes are performed only by
-- the authenticated SECURITY DEFINER rotation RPC.
grant select on public.health_e2ee_key_versions to authenticated;
create policy health_e2ee_key_versions_select_own on public.health_e2ee_key_versions
  for select to authenticated using (user_id = (select auth.uid()));

-- Pairing sessions and the legacy migration map are RPC-only. Their
-- SECURITY DEFINER RPCs perform auth.uid() ownership checks; direct table
-- grants and policies are intentionally denied.
revoke all on public.health_e2ee_pairing_sessions, public.health_legacy_migration_map from anon, authenticated;
create policy health_e2ee_pairing_sessions_deny_client on public.health_e2ee_pairing_sessions
  for all to anon, authenticated using (false) with check (false);
create policy health_legacy_migration_map_deny_client on public.health_legacy_migration_map
  for all to anon, authenticated using (false) with check (false);


-- Reminder diagnostics and notification history are visible, never mutable,
-- through the authenticated API. Server hooks write them with service_role.
grant select on public.notification_log, public.reminder_debug_log to authenticated;
create policy notification_log_select_own on public.notification_log
  for select to authenticated using (user_id = (select auth.uid()));
create policy reminder_debug_log_select_own on public.reminder_debug_log
  for select to authenticated using (user_id = (select auth.uid()));

-- 5) Tables with a direct user_id owner. Policies require the JWT subject to
-- equal user_id for reads and writes. No anon policy is created.
do $$
declare t text;
begin
  foreach t in array array[
    'ai_action_log',
    'ai_conversations',
    'ai_preferences',
    'development_tasks',
    'food_log',
    'food_scans',
    'health_e2ee_recovery_envelopes',
    'legal_consent',
    'profiles',
    'push_subscriptions',
    'reminder_settings',
    'sport_exercises',
    'sport_programs',
    'sport_progression_targets',
    'sport_workout_sessions',
    'user_biometrics_e2ee',
    'user_state'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_user_isolation', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_user_isolation', t
    );
  end loop;
end $$;

-- Legacy plaintext health rows are read-only. New writes go to consent-scoped
-- health_samples_e2ee; legacy migration is performed through its SECURITY DEFINER RPC.
grant select on public.health_samples to authenticated;
create policy health_samples_legacy_select_own on public.health_samples
  for select to authenticated using (user_id = (select auth.uid()));

-- Billing records are server-owned (plan/status must not be user-editable).
grant select on public.billing_customers, public.billing_subscriptions, public.billing_trials to authenticated;
drop policy if exists billing_customers_read_own on public.billing_customers;
drop policy if exists billing_subscriptions_read_own on public.billing_subscriptions;
drop policy if exists billing_trials_read_own on public.billing_trials;
create policy billing_customers_read_own on public.billing_customers for select to authenticated using (user_id = (select auth.uid()));
create policy billing_subscriptions_read_own on public.billing_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy billing_trials_read_own on public.billing_trials for select to authenticated using (user_id = (select auth.uid()));

-- Deletion requests may be submitted/read by the owner; status is server-managed.
grant select, insert on public.data_deletion_requests to authenticated;
drop policy if exists data_deletion_requests_submit_own on public.data_deletion_requests;
drop policy if exists data_deletion_requests_read_own on public.data_deletion_requests;
create policy data_deletion_requests_submit_own on public.data_deletion_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and completed_at is null
    and error_code is null
  );
create policy data_deletion_requests_read_own on public.data_deletion_requests for select to authenticated using (user_id = (select auth.uid()));

-- Tables with user_id also carry optional parent references. Direct ownership
-- alone is not enough: ensure a supplied parent ID belongs to the same account.
drop policy if exists development_tasks_user_isolation on public.development_tasks;
create policy development_tasks_user_isolation on public.development_tasks for all to authenticated
using (user_id = (select auth.uid()) and (conversation_id is null or exists (
  select 1 from public.ai_conversations c where c.id = development_tasks.conversation_id and c.user_id = (select auth.uid())
)))
with check (user_id = (select auth.uid()) and (conversation_id is null or exists (
  select 1 from public.ai_conversations c where c.id = development_tasks.conversation_id and c.user_id = (select auth.uid())
)));

drop policy if exists sport_workout_sessions_user_isolation on public.sport_workout_sessions;
create policy sport_workout_sessions_user_isolation on public.sport_workout_sessions for all to authenticated
using (user_id = (select auth.uid()) and (program_id is null or exists (
  select 1 from public.sport_programs p where p.id = sport_workout_sessions.program_id and p.user_id = (select auth.uid())
)))
with check (user_id = (select auth.uid()) and (program_id is null or exists (
  select 1 from public.sport_programs p where p.id = sport_workout_sessions.program_id and p.user_id = (select auth.uid())
)));

-- 5) Cross-account relationship guards for child tables without user_id.
-- Parent ownership is checked at every hop; child IDs alone are never trusted.
-- Consent records are immutable audit evidence: owner SELECT/INSERT only.
-- Keep the audit ledger append-only and let PostgreSQL own ordering metadata.
-- The clients may supply the consent decision/version but never id or created_at.
grant select on public.consent_records to authenticated;
revoke insert on public.consent_records from authenticated;
grant insert (user_id, consent_type, granted, legal_version, policy_version)
  on public.consent_records to authenticated;
drop policy if exists consent_records_select_own on public.consent_records;
drop policy if exists consent_records_insert_own on public.consent_records;
create policy consent_records_select_own on public.consent_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy consent_records_insert_own on public.consent_records
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and created_at = (select now())
  );

grant select, insert, update, delete on public.ai_messages to authenticated;
drop policy if exists ai_messages_user_isolation on public.ai_messages;
create policy ai_messages_user_isolation on public.ai_messages
for all to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id and c.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id and c.user_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.sport_program_items to authenticated;
drop policy if exists sport_program_items_user_isolation on public.sport_program_items;
create policy sport_program_items_user_isolation on public.sport_program_items
for all to authenticated
using (
  exists (select 1 from public.sport_programs p
          where p.id = sport_program_items.program_id and p.user_id = (select auth.uid()))
  and exists (select 1 from public.sport_exercises e
              where e.id = sport_program_items.exercise_id and e.user_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.sport_programs p
          where p.id = sport_program_items.program_id and p.user_id = (select auth.uid()))
  and exists (select 1 from public.sport_exercises e
              where e.id = sport_program_items.exercise_id and e.user_id = (select auth.uid()))
);

grant select, insert, update, delete on public.sport_workout_exercises to authenticated;
drop policy if exists sport_workout_exercises_user_isolation on public.sport_workout_exercises;
create policy sport_workout_exercises_user_isolation on public.sport_workout_exercises
for all to authenticated
using (
  exists (select 1 from public.sport_workout_sessions s
          where s.id = sport_workout_exercises.session_id and s.user_id = (select auth.uid()))
  and exists (select 1 from public.sport_exercises e
              where e.id = sport_workout_exercises.exercise_id and e.user_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.sport_workout_sessions s
          where s.id = sport_workout_exercises.session_id and s.user_id = (select auth.uid()))
  and exists (select 1 from public.sport_exercises e
              where e.id = sport_workout_exercises.exercise_id and e.user_id = (select auth.uid())
));

grant select, insert, update, delete on public.sport_workout_sets to authenticated;
drop policy if exists sport_workout_sets_user_isolation on public.sport_workout_sets;
create policy sport_workout_sets_user_isolation on public.sport_workout_sets
for all to authenticated
using (
  exists (
    select 1
    from public.sport_workout_exercises we
    join public.sport_workout_sessions s on s.id = we.session_id
    where we.id = sport_workout_sets.workout_exercise_id and s.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.sport_workout_exercises we
    join public.sport_workout_sessions s on s.id = we.session_id
    where we.id = sport_workout_sets.workout_exercise_id and s.user_id = (select auth.uid())
  )
);

-- Harden nullable/child foreign-key-like fields that currently lack SQL FKs.
drop policy if exists ai_action_log_user_isolation on public.ai_action_log;
create policy ai_action_log_user_isolation on public.ai_action_log for all to authenticated
using (user_id = (select auth.uid()) and (conversation_id is null or exists (
  select 1 from public.ai_conversations c where c.id = ai_action_log.conversation_id and c.user_id = (select auth.uid())
)))
with check (user_id = (select auth.uid()) and (conversation_id is null or exists (
  select 1 from public.ai_conversations c where c.id = ai_action_log.conversation_id and c.user_id = (select auth.uid())
)));

drop policy if exists sport_progression_targets_user_isolation on public.sport_progression_targets;
create policy sport_progression_targets_user_isolation on public.sport_progression_targets for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.sport_exercises e where e.id = sport_progression_targets.exercise_id and e.user_id = (select auth.uid())
) and (based_on_session_id is null or exists (
  select 1 from public.sport_workout_sessions s where s.id = sport_progression_targets.based_on_session_id and s.user_id = (select auth.uid())
)))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.sport_exercises e where e.id = sport_progression_targets.exercise_id and e.user_id = (select auth.uid())
) and (based_on_session_id is null or exists (
  select 1 from public.sport_workout_sessions s where s.id = sport_progression_targets.based_on_session_id and s.user_id = (select auth.uid())
)));

-- 6) Service-only tables: no API grants; explicit deny policies defend against
-- a later accidental GRANT. These contain secrets, idempotency internals, or
-- backend-generated event/audit records and are accessed with trusted server code.
drop policy if exists ai_provider_secrets_deny_client on public.ai_provider_secrets;
create policy ai_provider_secrets_deny_client on public.ai_provider_secrets
  for all to anon, authenticated using (false) with check (false);

drop policy if exists ai_tool_idempotency_deny_client on public.ai_tool_idempotency;
create policy ai_tool_idempotency_deny_client on public.ai_tool_idempotency
  for all to anon, authenticated using (false) with check (false);

drop policy if exists audit_log_deny_client on public.audit_log;
create policy audit_log_deny_client on public.audit_log
  for all to anon, authenticated using (false) with check (false);

drop policy if exists billing_events_deny_client on public.billing_events;
create policy billing_events_deny_client on public.billing_events
  for all to anon, authenticated using (false) with check (false);
commit;
