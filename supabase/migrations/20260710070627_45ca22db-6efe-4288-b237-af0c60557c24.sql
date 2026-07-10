CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  display_name text,
  email text,
  age int,
  sex text CHECK (sex IN ('male','female','other')),
  height_cm numeric,
  weight_kg numeric,
  weight_goal_kg numeric,
  body_fat_goal_pct numeric,
  muscle_mass_goal_pct numeric,
  daily_calorie_goal int DEFAULT 2300,
  daily_protein_goal int DEFAULT 140,
  daily_water_ml_goal int DEFAULT 2500,
  training_goal text CHECK (training_goal IN ('strength','hypertrophy','fitness','cut','none')) DEFAULT 'hypertrophy',
  activity_level text DEFAULT 'moderate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own profile" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.food_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  meal text NOT NULL DEFAULT 'Déjeuner',
  name text NOT NULL,
  kcal numeric NOT NULL DEFAULT 0,
  protein_g numeric NOT NULL DEFAULT 0,
  carbs_g numeric NOT NULL DEFAULT 0,
  fat_g numeric NOT NULL DEFAULT 0,
  fiber_g numeric DEFAULT 0,
  sugar_g numeric DEFAULT 0,
  sodium_mg numeric DEFAULT 0,
  source text CHECK (source IN ('manual','barcode','photo','recipe')) DEFAULT 'manual',
  health_score text CHECK (health_score IN ('green','orange','red')),
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_log TO authenticated;
GRANT ALL ON public.food_log TO service_role;
ALTER TABLE public.food_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_food_log_user_date ON public.food_log(user_id, log_date DESC);
CREATE POLICY "Users can view own food log" ON public.food_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own food log" ON public.food_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own food log" ON public.food_log FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own food log" ON public.food_log FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.food_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('barcode','photo')),
  barcode text,
  product_name text,
  brand text,
  kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  sugar_g numeric,
  salt_g numeric,
  sodium_mg numeric,
  nutri_score text,
  nova_group int,
  health_score text CHECK (health_score IN ('green','orange','red')),
  warnings text[],
  ingredients text,
  image_url text,
  raw jsonb DEFAULT '{}'::jsonb,
  favorite boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_scans TO authenticated;
GRANT ALL ON public.food_scans TO service_role;
ALTER TABLE public.food_scans ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_food_scans_user ON public.food_scans(user_id, created_at DESC);
CREATE POLICY "Users can view own scans" ON public.food_scans FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own scans" ON public.food_scans FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own scans" ON public.food_scans FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own scans" ON public.food_scans FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.health_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL CHECK (type IN ('steps','kcal_active','heart_rate','distance_m','sleep_min')),
  value double precision NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_samples TO authenticated;
GRANT ALL ON public.health_samples TO service_role;
ALTER TABLE public.health_samples ENABLE ROW LEVEL SECURITY;
CREATE INDEX health_samples_user_ts_idx ON public.health_samples(user_id, ts DESC);
CREATE INDEX health_samples_user_type_ts_idx ON public.health_samples(user_id, type, ts DESC);
CREATE POLICY "Users can view own health samples" ON public.health_samples FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own health samples" ON public.health_samples FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own health samples" ON public.health_samples FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own health samples" ON public.health_samples FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.reminder_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('hydration','sleep','protein','daily_summary','inactivity')),
  enabled boolean NOT NULL DEFAULT true,
  time_local text,
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  threshold numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_settings TO authenticated;
GRANT ALL ON public.reminder_settings TO service_role;
ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own reminders" ON public.reminder_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own reminders" ON public.reminder_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reminders" ON public.reminder_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own reminders" ON public.reminder_settings FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER reminder_settings_touch BEFORE UPDATE ON public.reminder_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX notification_log_user_type_sent_idx ON public.notification_log(user_id, type, sent_at DESC);
CREATE POLICY "Users can view own notification log" ON public.notification_log FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.reminder_debug_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  reason text,
  trigger text NOT NULL DEFAULT 'pg_cron',
  target_segment text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reminder_debug_log TO authenticated;
GRANT ALL ON public.reminder_debug_log TO service_role;
ALTER TABLE public.reminder_debug_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX reminder_debug_log_user_created_idx ON public.reminder_debug_log(user_id, created_at DESC);
CREATE POLICY "Users can view own reminder debug log" ON public.reminder_debug_log FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.user_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_state TO authenticated;
GRANT ALL ON public.user_state TO service_role;
ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;
CREATE INDEX user_state_user_key_idx ON public.user_state(user_id, key);
CREATE POLICY "Users can manage own synced state" ON public.user_state FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER user_state_touch BEFORE UPDATE ON public.user_state FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();