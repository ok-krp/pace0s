-- Least-privilege baseline for client-facing public tables.
-- Prepared for review; NOT applied to any Supabase project by this commit.
--
-- Design:
--   * anon receives no direct table privileges.
--   * authenticated receives only CRUD operations represented by the
--     corresponding RLS policies.
--   * REFERENCES/TRIGGER/TRUNCATE are never client privileges.
--   * server-only/internal tables receive no authenticated grant.
--
-- This migration deliberately does not change RLS policies or SECURITY DEFINER
-- functions. Those are audited separately before application.

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- User-owned CRUD tables: RLS remains the authorization boundary.
grant select, insert, update, delete on table public.ai_conversations to authenticated;
grant select, insert, update, delete on table public.ai_messages to authenticated;
grant select, insert, update, delete on table public.ai_preferences to authenticated;
grant select, insert on table public.ai_action_log to authenticated;

grant select, insert, update, delete on table public.food_log to authenticated;
grant select, insert, update, delete on table public.food_scans to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select, insert, update on table public.reminder_settings to authenticated;
grant select on table public.reminder_debug_log to authenticated;
grant select, insert, update, delete on table public.sport_programs to authenticated;
grant select, insert, update, delete on table public.sport_program_items to authenticated;
grant select, insert, update, delete on table public.sport_progression_targets to authenticated;
grant select, insert, update, delete on table public.sport_workout_sessions to authenticated;
grant select, insert, update, delete on table public.sport_workout_exercises to authenticated;
grant select, insert, update, delete on table public.sport_workout_sets to authenticated;
grant select, insert, update, delete on table public.user_biometrics_e2ee to authenticated;
grant select, insert, update, delete on table public.user_state to authenticated;

-- Health E2EE direct access is deliberately narrower.
grant select, insert, update on table public.health_e2ee_devices to authenticated;
grant select, insert, delete on table public.health_e2ee_key_envelopes to authenticated;
grant select on table public.health_e2ee_key_versions to authenticated;
grant select, insert, delete on table public.health_samples_e2ee to authenticated;
grant select, insert, update, delete on table public.health_e2ee_recovery_envelopes to authenticated;

-- Sensitive/legal tables: only the operations represented by current policies.
grant select, insert on table public.consent_records to authenticated;
grant select, insert on table public.data_deletion_requests to authenticated;
grant select, insert, update on table public.legal_consent to authenticated;
grant select, delete on table public.health_samples to authenticated;

-- Read-only reference/catalog data.
grant select on table public.nutrition_canonical_dishes to authenticated;
grant select on table public.nutrition_data_sources to authenticated;
grant select on table public.nutrition_dish_references to authenticated;
grant select on table public.nutrition_reference_dishes to authenticated;
grant select on table public.nutrition_reference_foods to authenticated;
grant select on table public.nutrition_reference_sources to authenticated;
grant select on table public.sport_exercises to authenticated;

-- Billing state is read-only from the client.
grant select on table public.billing_subscriptions to authenticated;

-- Explicitly server-only / internal: no client table grants.
-- ai_provider_secrets, ai_tool_idempotency, audit_log, billing_events,
-- billing_customers, billing_trials, development_tasks, health_e2ee_pairing_sessions,
-- health_legacy_migration_map and notification_log remain inaccessible by default.
-- development_tasks is intentionally not granted here pending moving its direct
-- client reads/writes behind an authenticated server endpoint.
