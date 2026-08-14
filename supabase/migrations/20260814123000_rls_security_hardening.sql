-- PaceOS security hardening
-- This migration is intentionally additive and non-destructive.
-- Existing RLS policies are preserved; this migration strengthens the database
-- boundary by forcing RLS and requiring user-owned rows to reference auth.users.

-- 1. Force RLS so table owners cannot accidentally bypass the policies.
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.food_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.food_scans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.health_samples FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_debug_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_state FORCE ROW LEVEL SECURITY;
ALTER TABLE public.legal_consent FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.development_tasks FORCE ROW LEVEL SECURITY;

-- 2. Every user-owned row must belong to a real authenticated user.
-- NOT VALID makes this safe for existing installations that may contain
-- legacy/orphaned rows: existing rows are not blocked by migration, while all
-- newly inserted/updated rows are checked immediately.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.food_log
  ADD CONSTRAINT food_log_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.food_scans
  ADD CONSTRAINT food_scans_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.health_samples
  ADD CONSTRAINT health_samples_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.reminder_settings
  ADD CONSTRAINT reminder_settings_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.reminder_debug_log
  ADD CONSTRAINT reminder_debug_log_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.user_state
  ADD CONSTRAINT user_state_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.legal_consent
  ADD CONSTRAINT legal_consent_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.ai_conversations
  ADD CONSTRAINT ai_conversations_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.ai_messages
  ADD CONSTRAINT ai_messages_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.ai_preferences
  ADD CONSTRAINT ai_preferences_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.ai_action_log
  ADD CONSTRAINT ai_action_log_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.development_tasks
  ADD CONSTRAINT development_tasks_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

-- 3. Make ownership lookups consistently cheap.
CREATE INDEX IF NOT EXISTS profiles_user_id_idx ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS food_log_user_id_idx ON public.food_log(user_id);
CREATE INDEX IF NOT EXISTS food_scans_user_id_idx ON public.food_scans(user_id);
CREATE INDEX IF NOT EXISTS health_samples_user_id_idx ON public.health_samples(user_id);
CREATE INDEX IF NOT EXISTS reminder_settings_user_id_idx ON public.reminder_settings(user_id);
CREATE INDEX IF NOT EXISTS notification_log_user_id_idx ON public.notification_log(user_id);
CREATE INDEX IF NOT EXISTS reminder_debug_log_user_id_idx ON public.reminder_debug_log(user_id);
CREATE INDEX IF NOT EXISTS user_state_user_id_idx ON public.user_state(user_id);
CREATE INDEX IF NOT EXISTS legal_consent_user_id_idx ON public.legal_consent(user_id);
CREATE INDEX IF NOT EXISTS ai_conversations_user_id_idx ON public.ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS ai_messages_user_id_idx ON public.ai_messages(user_id);
CREATE INDEX IF NOT EXISTS ai_preferences_user_id_idx ON public.ai_preferences(user_id);
CREATE INDEX IF NOT EXISTS ai_action_log_user_id_idx ON public.ai_action_log(user_id);
CREATE INDEX IF NOT EXISTS development_tasks_user_id_idx ON public.development_tasks(user_id);

-- 4. Security note for future migrations:
-- Do not grant anon access to user-owned tables.
-- Do not use SECURITY DEFINER for user-data access without an explicit
-- authorization check against auth.uid().
-- Keep service_role access server-side only.
