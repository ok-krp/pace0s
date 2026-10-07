begin;

revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on table
  public.ai_action_log, public.ai_conversations, public.ai_messages,
  public.ai_preferences, public.development_tasks, public.food_log,
  public.food_scans, public.health_e2ee_recovery_envelopes, public.health_samples,
  public.legal_consent, public.profiles, public.push_subscriptions,
  public.reminder_settings, public.sport_exercises, public.sport_program_items,
  public.sport_programs, public.sport_progression_targets,
  public.sport_workout_exercises, public.sport_workout_sessions,
  public.sport_workout_sets, public.user_biometrics_e2ee, public.user_state
to authenticated;

grant select, insert, update on table public.health_e2ee_devices to authenticated;
grant select, insert, delete on table public.health_e2ee_key_envelopes to authenticated;
grant select on table public.health_e2ee_key_versions to authenticated;
grant select, insert, delete on table public.health_samples_e2ee to authenticated;

grant select on table
  public.billing_customers, public.billing_subscriptions, public.billing_trials,
  public.consent_records, public.data_deletion_requests, public.notification_log,
  public.reminder_debug_log, public.nutrition_canonical_dishes,
  public.nutrition_data_sources, public.nutrition_dish_references,
  public.nutrition_reference_dishes, public.nutrition_reference_foods,
  public.nutrition_reference_sources
to authenticated;

drop policy if exists health_e2ee_pairing_sessions_deny_client on public.health_e2ee_pairing_sessions;
create policy health_e2ee_pairing_sessions_deny_client on public.health_e2ee_pairing_sessions
  as restrictive for all to anon, authenticated using (false) with check (false);

drop policy if exists health_legacy_migration_map_deny_client on public.health_legacy_migration_map;
create policy health_legacy_migration_map_deny_client on public.health_legacy_migration_map
  as restrictive for all to anon, authenticated using (false) with check (false);

create or replace function public.prevent_user_id_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_user_id_mutation() from public, anon, authenticated, service_role;
grant execute on function public.prevent_user_id_mutation() to postgres;

drop trigger if exists trg_prevent_user_id_mutation on public.ai_action_log;
create trigger trg_prevent_user_id_mutation before update of user_id on public.ai_action_log for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.ai_conversations;
create trigger trg_prevent_user_id_mutation before update of user_id on public.ai_conversations for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.ai_messages;
create trigger trg_prevent_user_id_mutation before update of user_id on public.ai_messages for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.ai_preferences;
create trigger trg_prevent_user_id_mutation before update of user_id on public.ai_preferences for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.ai_provider_secrets;
create trigger trg_prevent_user_id_mutation before update of user_id on public.ai_provider_secrets for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.ai_tool_idempotency;
create trigger trg_prevent_user_id_mutation before update of user_id on public.ai_tool_idempotency for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.audit_log;
create trigger trg_prevent_user_id_mutation before update of user_id on public.audit_log for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.billing_customers;
create trigger trg_prevent_user_id_mutation before update of user_id on public.billing_customers for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.billing_subscriptions;
create trigger trg_prevent_user_id_mutation before update of user_id on public.billing_subscriptions for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.billing_trials;
create trigger trg_prevent_user_id_mutation before update of user_id on public.billing_trials for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.consent_records;
create trigger trg_prevent_user_id_mutation before update of user_id on public.consent_records for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.data_deletion_requests;
create trigger trg_prevent_user_id_mutation before update of user_id on public.data_deletion_requests for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.development_tasks;
create trigger trg_prevent_user_id_mutation before update of user_id on public.development_tasks for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.food_log;
create trigger trg_prevent_user_id_mutation before update of user_id on public.food_log for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.food_scans;
create trigger trg_prevent_user_id_mutation before update of user_id on public.food_scans for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.health_e2ee_devices;
create trigger trg_prevent_user_id_mutation before update of user_id on public.health_e2ee_devices for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.health_e2ee_key_envelopes;
create trigger trg_prevent_user_id_mutation before update of user_id on public.health_e2ee_key_envelopes for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.health_e2ee_key_versions;
create trigger trg_prevent_user_id_mutation before update of user_id on public.health_e2ee_key_versions for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.health_e2ee_pairing_sessions;
create trigger trg_prevent_user_id_mutation before update of user_id on public.health_e2ee_pairing_sessions for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.health_e2ee_recovery_envelopes;
create trigger trg_prevent_user_id_mutation before update of user_id on public.health_e2ee_recovery_envelopes for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.health_legacy_migration_map;
create trigger trg_prevent_user_id_mutation before update of user_id on public.health_legacy_migration_map for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.health_samples;
create trigger trg_prevent_user_id_mutation before update of user_id on public.health_samples for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.health_samples_e2ee;
create trigger trg_prevent_user_id_mutation before update of user_id on public.health_samples_e2ee for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.legal_consent;
create trigger trg_prevent_user_id_mutation before update of user_id on public.legal_consent for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.notification_log;
create trigger trg_prevent_user_id_mutation before update of user_id on public.notification_log for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.profiles;
create trigger trg_prevent_user_id_mutation before update of user_id on public.profiles for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.push_subscriptions;
create trigger trg_prevent_user_id_mutation before update of user_id on public.push_subscriptions for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.reminder_debug_log;
create trigger trg_prevent_user_id_mutation before update of user_id on public.reminder_debug_log for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.reminder_settings;
create trigger trg_prevent_user_id_mutation before update of user_id on public.reminder_settings for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.sport_exercises;
create trigger trg_prevent_user_id_mutation before update of user_id on public.sport_exercises for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.sport_programs;
create trigger trg_prevent_user_id_mutation before update of user_id on public.sport_programs for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.sport_progression_targets;
create trigger trg_prevent_user_id_mutation before update of user_id on public.sport_progression_targets for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.sport_workout_sessions;
create trigger trg_prevent_user_id_mutation before update of user_id on public.sport_workout_sessions for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.user_biometrics_e2ee;
create trigger trg_prevent_user_id_mutation before update of user_id on public.user_biometrics_e2ee for each row execute function public.prevent_user_id_mutation();
drop trigger if exists trg_prevent_user_id_mutation on public.user_state;
create trigger trg_prevent_user_id_mutation before update of user_id on public.user_state for each row execute function public.prevent_user_id_mutation();

commit;