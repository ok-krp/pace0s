-- Pace V4 backend reconciliation for the Lovable -> Vercel/Supabase migration.
-- Non-destructive: existing rows are preserved.

-- Shared timestamp trigger.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Legal consent used by cloud sync and nutrition AI.
CREATE TABLE IF NOT EXISTS public.legal_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  region text NOT NULL,
  eula_version text NOT NULL,
  privacy_version text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip_country text,
  opts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, eula_version, privacy_version)
);
ALTER TABLE public.legal_consent ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_consent TO authenticated;
GRANT ALL ON public.legal_consent TO service_role;
DROP POLICY IF EXISTS "Users can view their own legal consent" ON public.legal_consent;
DROP POLICY IF EXISTS "Users can create their own legal consent" ON public.legal_consent;
DROP POLICY IF EXISTS "Users can update their own legal consent" ON public.legal_consent;
DROP POLICY IF EXISTS "Users can delete their own legal consent" ON public.legal_consent;
CREATE POLICY "Users can view their own legal consent" ON public.legal_consent FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own legal consent" ON public.legal_consent FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own legal consent" ON public.legal_consent FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own legal consent" ON public.legal_consent FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_legal_consent_updated_at ON public.legal_consent;
CREATE TRIGGER update_legal_consent_updated_at BEFORE UPDATE ON public.legal_consent FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- User-state sync.
ALTER TABLE public.user_state ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_state TO authenticated;
GRANT ALL ON public.user_state TO service_role;
DROP POLICY IF EXISTS "Users can manage own synced state" ON public.user_state;
CREATE POLICY "Users can manage own synced state" ON public.user_state FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS user_state_user_key_idx ON public.user_state(user_id, key);

CREATE OR REPLACE FUNCTION public.upsert_user_state_if_newer(
  p_user_id uuid, p_key text, p_value jsonb, p_updated_at timestamptz, p_updated_by text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE accepted boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_key IS NULL OR p_key = '' THEN RAISE EXCEPTION 'key is required'; END IF;
  INSERT INTO public.user_state (user_id, key, value, updated_at, updated_by)
  VALUES (p_user_id, p_key, p_value, COALESCE(p_updated_at, now()), p_updated_by)
  ON CONFLICT (user_id, key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
    WHERE public.user_state.updated_at IS NULL OR EXCLUDED.updated_at > public.user_state.updated_at
  RETURNING true INTO accepted;
  RETURN COALESCE(accepted, false);
END; $$;
REVOKE ALL ON FUNCTION public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text) TO authenticated;

-- Nutrition persistence tables: preserve existing tables and restore user isolation.
ALTER TABLE public.food_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_samples ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_log, public.food_scans, public.health_samples TO authenticated;
GRANT ALL ON public.food_log, public.food_scans, public.health_samples TO service_role;
DROP POLICY IF EXISTS "Users can view own food log" ON public.food_log;
DROP POLICY IF EXISTS "Users can create own food log" ON public.food_log;
DROP POLICY IF EXISTS "Users can update own food log" ON public.food_log;
DROP POLICY IF EXISTS "Users can delete own food log" ON public.food_log;
CREATE POLICY "Users can view own food log" ON public.food_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own food log" ON public.food_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own food log" ON public.food_log FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own food log" ON public.food_log FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view own scans" ON public.food_scans;
DROP POLICY IF EXISTS "Users can create own scans" ON public.food_scans;
DROP POLICY IF EXISTS "Users can update own scans" ON public.food_scans;
DROP POLICY IF EXISTS "Users can delete own scans" ON public.food_scans;
CREATE POLICY "Users can view own scans" ON public.food_scans FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own scans" ON public.food_scans FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own scans" ON public.food_scans FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own scans" ON public.food_scans FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view own health samples" ON public.health_samples;
DROP POLICY IF EXISTS "Users can create own health samples" ON public.health_samples;
DROP POLICY IF EXISTS "Users can update own health samples" ON public.health_samples;
DROP POLICY IF EXISTS "Users can delete own health samples" ON public.health_samples;
CREATE POLICY "Users can view own health samples" ON public.health_samples FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own health samples" ON public.health_samples FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own health samples" ON public.health_samples FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own health samples" ON public.health_samples FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON public.food_log(user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_food_scans_user ON public.food_scans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS health_samples_user_ts_idx ON public.health_samples(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS health_samples_user_type_ts_idx ON public.health_samples(user_id, type, ts DESC);

-- Profile reconciliation. Keep the legacy id/full_name/avatar_url columns for compatibility.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age integer;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sex text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS height_cm numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weight_kg numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weight_goal_kg numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS body_fat_goal_pct numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS muscle_mass_goal_pct numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS daily_calorie_goal integer DEFAULT 2300;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS daily_protein_goal integer DEFAULT 140;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS daily_water_ml_goal integer DEFAULT 2500;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS training_goal text DEFAULT 'hypertrophy';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS activity_level text DEFAULT 'moderate';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS training_sessions_goal integer DEFAULT 3;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_by text;
UPDATE public.profiles SET user_id = id WHERE user_id IS NULL;
UPDATE public.profiles SET display_name = full_name WHERE display_name IS NULL AND full_name IS NOT NULL;
UPDATE public.profiles SET email = u.email FROM auth.users u WHERE u.id = profiles.user_id AND profiles.email IS NULL;
ALTER TABLE public.profiles ALTER COLUMN user_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique_idx ON public.profiles(user_id);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can create own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can manage their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can view own profile by user_id" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own profile by user_id" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile by user_id" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own profile by user_id" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.upsert_profile_if_newer(
  p_user_id uuid, p_profile jsonb, p_updated_at timestamptz, p_updated_by text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE accepted boolean := false; effective_updated_at timestamptz := COALESCE(p_updated_at, now());
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE EXCEPTION 'not authorized'; END IF;
  INSERT INTO public.profiles (
    user_id, display_name, email, age, sex, height_cm, weight_kg, weight_goal_kg,
    body_fat_goal_pct, muscle_mass_goal_pct, daily_calorie_goal, daily_protein_goal,
    daily_water_ml_goal, training_goal, activity_level, training_sessions_goal, updated_at, updated_by
  ) VALUES (
    p_user_id, p_profile->>'display_name', p_profile->>'email', NULLIF(p_profile->>'age','')::integer,
    p_profile->>'sex', NULLIF(p_profile->>'height_cm','')::numeric, NULLIF(p_profile->>'weight_kg','')::numeric,
    NULLIF(p_profile->>'weight_goal_kg','')::numeric, NULLIF(p_profile->>'body_fat_goal_pct','')::numeric,
    NULLIF(p_profile->>'muscle_mass_goal_pct','')::numeric, NULLIF(p_profile->>'daily_calorie_goal','')::integer,
    NULLIF(p_profile->>'daily_protein_goal','')::integer, NULLIF(p_profile->>'daily_water_ml_goal','')::integer,
    p_profile->>'training_goal', p_profile->>'activity_level', COALESCE(NULLIF(p_profile->>'training_sessions_goal','')::integer,3), effective_updated_at, p_updated_by
  ) ON CONFLICT (user_id) DO UPDATE SET
    display_name=EXCLUDED.display_name, email=EXCLUDED.email, age=EXCLUDED.age, sex=EXCLUDED.sex,
    height_cm=EXCLUDED.height_cm, weight_kg=EXCLUDED.weight_kg, weight_goal_kg=EXCLUDED.weight_goal_kg,
    body_fat_goal_pct=EXCLUDED.body_fat_goal_pct, muscle_mass_goal_pct=EXCLUDED.muscle_mass_goal_pct,
    daily_calorie_goal=EXCLUDED.daily_calorie_goal, daily_protein_goal=EXCLUDED.daily_protein_goal,
    daily_water_ml_goal=EXCLUDED.daily_water_ml_goal, training_goal=EXCLUDED.training_goal,
    activity_level=EXCLUDED.activity_level, training_sessions_goal=EXCLUDED.training_sessions_goal,
    updated_at=EXCLUDED.updated_at, updated_by=EXCLUDED.updated_by
  WHERE public.profiles.updated_at IS NULL OR EXCLUDED.updated_at > public.profiles.updated_at
  RETURNING true INTO accepted;
  RETURN COALESCE(accepted,false);
END; $$;
REVOKE ALL ON FUNCTION public.upsert_profile_if_newer(uuid,jsonb,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_profile_if_newer(uuid,jsonb,timestamptz,text) TO authenticated;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.user_state REPLICA IDENTITY FULL;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_state; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AI persistence and BYOK metadata.
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, agent_type text NOT NULL CHECK (agent_type IN ('coach','build')),
  title text NOT NULL DEFAULT 'Nouvelle conversation', memory_summary text, summary text, summarized_count integer NOT NULL DEFAULT 0,
  is_starred boolean NOT NULL DEFAULT false, is_archived boolean NOT NULL DEFAULT false, is_ephemeral boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, role text NOT NULL CHECK (role IN ('user','assistant','system')), parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  plain_text text NOT NULL DEFAULT '', model_message_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_preferences (
  user_id uuid PRIMARY KEY, memory_level text NOT NULL DEFAULT 'limited' CHECK (memory_level IN ('none','limited','complete')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb, confirm_actions boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  coach_ai_source text NOT NULL DEFAULT 'pace', coach_ai_provider text NOT NULL DEFAULT 'gemini', coach_ai_model text NOT NULL DEFAULT 'gemini-2.5-flash', coach_ai_base_url text,
  build_ai_source text NOT NULL DEFAULT 'pace', build_ai_provider text NOT NULL DEFAULT 'gemini', build_ai_model text NOT NULL DEFAULT 'gemini-2.5-flash', build_ai_base_url text
);
CREATE TABLE IF NOT EXISTS public.ai_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  agent_type text NOT NULL CHECK (agent_type IN ('coach','build')), action_type text NOT NULL, label text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','executed','rejected','failed')), error_message text, created_at timestamptz NOT NULL DEFAULT now(), executed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.development_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('bug','improvement','feature','task')), title text NOT NULL, description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')), status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','planned','in_progress','done','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_provider_secrets (
  user_id uuid NOT NULL, provider text NOT NULL CHECK (provider IN ('openai','anthropic','gemini','openrouter','custom')), encrypted_api_key text NOT NULL,
  key_last4 text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id,provider)
);
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_secrets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversations, public.ai_messages, public.ai_preferences, public.ai_action_log, public.development_tasks TO authenticated;
GRANT ALL ON public.ai_conversations, public.ai_messages, public.ai_preferences, public.ai_action_log, public.development_tasks TO service_role;
REVOKE ALL ON public.ai_provider_secrets FROM anon, authenticated;
GRANT ALL ON public.ai_provider_secrets TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_conversations' AND policyname='Users manage own AI conversations') THEN CREATE POLICY "Users manage own AI conversations" ON public.ai_conversations FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_messages' AND policyname='Users manage own AI messages') THEN CREATE POLICY "Users manage own AI messages" ON public.ai_messages FOR ALL TO authenticated USING (auth.uid()=user_id AND EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id=conversation_id AND c.user_id=auth.uid())) WITH CHECK (auth.uid()=user_id AND EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id=conversation_id AND c.user_id=auth.uid())); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_preferences' AND policyname='Users manage own AI preferences') THEN CREATE POLICY "Users manage own AI preferences" ON public.ai_preferences FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_action_log' AND policyname='Users manage own AI action log') THEN CREATE POLICY "Users manage own AI action log" ON public.ai_action_log FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='development_tasks' AND policyname='Users manage own development tasks') THEN CREATE POLICY "Users manage own development tasks" ON public.development_tasks FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id); END IF;
END $$;
CREATE INDEX IF NOT EXISTS ai_conversations_user_agent_updated_idx ON public.ai_conversations(user_id,agent_type,updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx ON public.ai_messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS ai_action_log_user_created_idx ON public.ai_action_log(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS development_tasks_user_status_idx ON public.development_tasks(user_id,status,updated_at DESC);
CREATE OR REPLACE FUNCTION public.touch_ai_provider_secret_updated_at() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END; $$;
REVOKE EXECUTE ON FUNCTION public.touch_ai_provider_secret_updated_at() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ai_provider_secrets_touch ON public.ai_provider_secrets;
CREATE TRIGGER ai_provider_secrets_touch BEFORE UPDATE ON public.ai_provider_secrets FOR EACH ROW EXECUTE FUNCTION public.touch_ai_provider_secret_updated_at();
DROP TRIGGER IF EXISTS ai_conversations_touch ON public.ai_conversations;
CREATE TRIGGER ai_conversations_touch BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS ai_preferences_touch ON public.ai_preferences;
CREATE TRIGGER ai_preferences_touch BEFORE UPDATE ON public.ai_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS development_tasks_touch ON public.development_tasks;
CREATE TRIGGER development_tasks_touch BEFORE UPDATE ON public.development_tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Reminder and push persistence.
CREATE TABLE IF NOT EXISTS public.reminder_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true, time_local text, timezone text NOT NULL DEFAULT 'Europe/Paris', threshold numeric,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,type)
);
CREATE TABLE IF NOT EXISTS public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(), payload jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.reminder_debug_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL, status text NOT NULL, reason text,
  trigger text NOT NULL DEFAULT 'pg_cron', target_segment text, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, onesignal_subscription_id text NOT NULL,
  platform text NOT NULL DEFAULT 'web', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,onesignal_subscription_id)
);
ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_debug_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_settings TO authenticated;
GRANT SELECT ON public.notification_log, public.reminder_debug_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.reminder_settings, public.notification_log, public.reminder_debug_log, public.push_subscriptions TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reminder_settings' AND policyname='Users can manage own reminders') THEN CREATE POLICY "Users can manage own reminders" ON public.reminder_settings FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notification_log' AND policyname='Users can view own notification log') THEN CREATE POLICY "Users can view own notification log" ON public.notification_log FOR SELECT TO authenticated USING (auth.uid()=user_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reminder_debug_log' AND policyname='Users can view own reminder debug log') THEN CREATE POLICY "Users can view own reminder debug log" ON public.reminder_debug_log FOR SELECT TO authenticated USING (auth.uid()=user_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='push_subscriptions' AND policyname='Users manage own push subscriptions') THEN CREATE POLICY "Users manage own push subscriptions" ON public.push_subscriptions FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id); END IF;
END $$;
CREATE INDEX IF NOT EXISTS reminder_settings_user_type_idx ON public.reminder_settings(user_id,type);
CREATE INDEX IF NOT EXISTS notification_log_user_type_sent_idx ON public.notification_log(user_id,type,sent_at DESC);
CREATE INDEX IF NOT EXISTS reminder_debug_log_user_created_idx ON public.reminder_debug_log(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_subscription_id_idx ON public.push_subscriptions(onesignal_subscription_id);
DROP TRIGGER IF EXISTS reminder_settings_touch ON public.reminder_settings;
CREATE TRIGGER reminder_settings_touch BEFORE UPDATE ON public.reminder_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst,'reload schema';