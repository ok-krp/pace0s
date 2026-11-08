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

-- 2) Remove inherited API-role privileges. Service role remains owner/bypass-RLS.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 3) Public, immutable nutrition/reference catalogues: read only.
grant select on table
  public.nutrition_canonical_dishes,
  public.nutrition_data_sources,
  public.nutrition_dish_references,
  public.nutrition_reference_dishes,
  public.nutrition_reference_foods,
  public.nutrition_reference_sources
to anon, authenticated;

-- 4) Tables with a direct user_id owner. Policies require the JWT subject to
-- equal user_id for reads and writes. No anon policy is created.
do $$
declare t text;
begin
  foreach t in array array[
    'ai_action_log','ai_conversations','ai_preferences','ai_provider_secrets',
    'ai_tool_idempotency','consent_records',
    'development_tasks','food_log','food_scans','health_e2ee_devices',
    'health_e2ee_key_envelopes','health_e2ee_key_versions',
    'health_e2ee_pairing_sessions','health_e2ee_recovery_envelopes',
    'health_legacy_migration_map','health_samples','health_samples_e2ee',
    'legal_consent','notification_log','profiles','push_subscriptions',
    'reminder_debug_log','reminder_settings','sport_exercises','sport_programs',
    'sport_progression_targets','sport_workout_sessions','user_biometrics_e2ee',
    'user_state'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_user_isolation', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_user_isolation', t
    );
  end loop;
end $$;

-- Billing records are server-owned (plan/status must not be user-editable).
grant select on public.billing_customers, public.billing_subscriptions, public.billing_trials to authenticated;
create policy billing_customers_read_own on public.billing_customers for select to authenticated using (user_id = (select auth.uid()));
create policy billing_subscriptions_read_own on public.billing_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy billing_trials_read_own on public.billing_trials for select to authenticated using (user_id = (select auth.uid()));

-- Deletion requests may be submitted/read by the owner; status is server-managed.
grant select, insert on public.data_deletion_requests to authenticated;
create policy data_deletion_requests_submit_own on public.data_deletion_requests for insert to authenticated with check (user_id = (select auth.uid()));
create policy data_deletion_requests_read_own on public.data_deletion_requests for select to authenticated using (user_id = (select auth.uid()));

-- 5) Cross-account relationship guards for child tables without user_id.
-- Parent ownership is checked at every hop; child IDs alone are never trusted.
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
);

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

drop policy if exists ai_tool_idempotency_user_isolation on public.ai_tool_idempotency;
create policy ai_tool_idempotency_user_isolation on public.ai_tool_idempotency for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.ai_conversations c where c.id = ai_tool_idempotency.conversation_id and c.user_id = (select auth.uid())
))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.ai_conversations c where c.id = ai_tool_idempotency.conversation_id and c.user_id = (select auth.uid())
));

drop policy if exists health_e2ee_key_envelopes_user_isolation on public.health_e2ee_key_envelopes;
create policy health_e2ee_key_envelopes_user_isolation on public.health_e2ee_key_envelopes for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.health_e2ee_devices d where d.id = health_e2ee_key_envelopes.device_id and d.user_id = (select auth.uid())
) and (sender_device_id is null or exists (
  select 1 from public.health_e2ee_devices d where d.id = health_e2ee_key_envelopes.sender_device_id and d.user_id = (select auth.uid())
)) and (pairing_session_id is null or exists (
  select 1 from public.health_e2ee_pairing_sessions p where p.id = health_e2ee_key_envelopes.pairing_session_id and p.user_id = (select auth.uid())
)))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.health_e2ee_devices d where d.id = health_e2ee_key_envelopes.device_id and d.user_id = (select auth.uid())
) and (sender_device_id is null or exists (
  select 1 from public.health_e2ee_devices d where d.id = health_e2ee_key_envelopes.sender_device_id and d.user_id = (select auth.uid())
)) and (pairing_session_id is null or exists (
  select 1 from public.health_e2ee_pairing_sessions p where p.id = health_e2ee_key_envelopes.pairing_session_id and p.user_id = (select auth.uid())
)));

drop policy if exists health_e2ee_pairing_sessions_user_isolation on public.health_e2ee_pairing_sessions;
create policy health_e2ee_pairing_sessions_user_isolation on public.health_e2ee_pairing_sessions for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.health_e2ee_devices d where d.id = health_e2ee_pairing_sessions.initiator_device_id and d.user_id = (select auth.uid())
) and (recipient_device_id is null or exists (
  select 1 from public.health_e2ee_devices d where d.id = health_e2ee_pairing_sessions.recipient_device_id and d.user_id = (select auth.uid())
)))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.health_e2ee_devices d where d.id = health_e2ee_pairing_sessions.initiator_device_id and d.user_id = (select auth.uid())
) and (recipient_device_id is null or exists (
  select 1 from public.health_e2ee_devices d where d.id = health_e2ee_pairing_sessions.recipient_device_id and d.user_id = (select auth.uid())
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

-- 6) Backend-only tables: deliberately no API grants or policies.
-- billing_events and audit_log are written by trusted server/service-role code.
-- The global REVOKE above keeps anon/authenticated out.

commit;
