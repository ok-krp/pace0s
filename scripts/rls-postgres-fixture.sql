-- Minimal PostgreSQL fixture matching every relation and column used by
-- supabase/migrations/20261108200000_rls_hardening_review.sql.
-- Run only in a disposable CI database.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $auth_uid$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$auth_uid$;

CREATE TABLE public.ai_action_log (id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid);
CREATE TABLE public.ai_conversations (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.ai_messages (id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid NOT NULL);
CREATE TABLE public.ai_preferences (user_id uuid PRIMARY KEY);
CREATE TABLE public.ai_provider_secrets (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.ai_tool_idempotency (id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid NOT NULL);
CREATE TABLE public.audit_log (id uuid PRIMARY KEY);
CREATE TABLE public.billing_customers (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.billing_events (id uuid PRIMARY KEY);
CREATE TABLE public.billing_subscriptions (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.billing_trials (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  consent_type text NOT NULL,
  granted boolean NOT NULL,
  legal_version text NOT NULL,
  policy_version text NOT NULL,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.data_deletion_requests (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz, error_code text, requested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.development_tasks (id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid);
CREATE TABLE public.food_log (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.food_scans (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.health_e2ee_devices (id uuid PRIMARY KEY, user_id uuid NOT NULL, revoked_at timestamptz);
CREATE TABLE public.health_e2ee_key_envelopes (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, device_id uuid NOT NULL,
  sender_device_id uuid, pairing_session_id uuid
);
CREATE TABLE public.health_e2ee_key_versions (id uuid PRIMARY KEY, user_id uuid NOT NULL, current_key_version integer NOT NULL DEFAULT 1);
CREATE TABLE public.health_e2ee_pairing_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, initiator_device_id uuid NOT NULL, recipient_device_id uuid
);
CREATE TABLE public.health_e2ee_recovery_envelopes (
  user_id uuid PRIMARY KEY,
  envelope text NOT NULL,
  nonce text NOT NULL,
  algorithm text NOT NULL DEFAULT 'PBKDF2-SHA-256/AES-256-GCM',
  key_version integer NOT NULL CHECK (key_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (algorithm = 'PBKDF2-SHA-256/AES-256-GCM')
);
CREATE TABLE public.health_legacy_migration_map (legacy_sample_id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.health_samples (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.health_samples_e2ee (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, ciphertext text NOT NULL DEFAULT 'cipher',
  nonce text NOT NULL DEFAULT 'nonce', algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  key_version integer NOT NULL DEFAULT 1, dedupe_hash text
);
CREATE TABLE public.legal_consent (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.notification_log (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.nutrition_canonical_dishes (id uuid PRIMARY KEY);
CREATE TABLE public.nutrition_data_sources (id text PRIMARY KEY);
CREATE TABLE public.nutrition_dish_references (id uuid PRIMARY KEY);
CREATE TABLE public.nutrition_reference_dishes (id uuid PRIMARY KEY);
CREATE TABLE public.nutrition_reference_foods (id uuid PRIMARY KEY);
CREATE TABLE public.nutrition_reference_sources (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.push_subscriptions (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.reminder_debug_log (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.reminder_settings (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.sport_exercises (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.sport_program_items (id uuid PRIMARY KEY, program_id uuid NOT NULL, exercise_id uuid NOT NULL);
CREATE TABLE public.sport_programs (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.sport_progression_targets (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, exercise_id uuid NOT NULL, based_on_session_id uuid
);
CREATE TABLE public.sport_workout_exercises (id uuid PRIMARY KEY, session_id uuid NOT NULL, exercise_id uuid NOT NULL);
CREATE TABLE public.sport_workout_sets (id uuid PRIMARY KEY, workout_exercise_id uuid NOT NULL);
CREATE TABLE public.sport_workout_sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL, program_id uuid);
CREATE TABLE public.user_biometrics_e2ee (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.user_state (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (user_id, key)
);

-- Simulate broad legacy grants and a stale permissive policy.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
CREATE POLICY fixture_stale_profiles_select ON public.profiles
  FOR SELECT TO authenticated USING (true);
