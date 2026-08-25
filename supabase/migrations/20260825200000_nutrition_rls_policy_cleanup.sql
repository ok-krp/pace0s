-- Keep one explicit user-isolation policy set per nutrition table.
-- This is idempotent and does not alter existing data.

ALTER TABLE public.food_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own food log" ON public.food_log;
DROP POLICY IF EXISTS "Users can create own food log" ON public.food_log;
DROP POLICY IF EXISTS "Users can update own food log" ON public.food_log;
DROP POLICY IF EXISTS "Users can delete own food log" ON public.food_log;
DROP POLICY IF EXISTS "Users can view own scans" ON public.food_scans;
DROP POLICY IF EXISTS "Users can create own scans" ON public.food_scans;
DROP POLICY IF EXISTS "Users can update own scans" ON public.food_scans;
DROP POLICY IF EXISTS "Users can delete own scans" ON public.food_scans;
DROP POLICY IF EXISTS "Users can view own health samples" ON public.health_samples;
DROP POLICY IF EXISTS "Users can create own health samples" ON public.health_samples;
DROP POLICY IF EXISTS "Users can update own health samples" ON public.health_samples;
DROP POLICY IF EXISTS "Users can delete own health samples" ON public.health_samples;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_scans' AND policyname='food_scans_select_own') THEN
    CREATE POLICY food_scans_select_own ON public.food_scans FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_scans' AND policyname='food_scans_insert_own') THEN
    CREATE POLICY food_scans_insert_own ON public.food_scans FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_scans' AND policyname='food_scans_update_own') THEN
    CREATE POLICY food_scans_update_own ON public.food_scans FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_scans' AND policyname='food_scans_delete_own') THEN
    CREATE POLICY food_scans_delete_own ON public.food_scans FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_log' AND policyname='food_log_select_own') THEN
    CREATE POLICY food_log_select_own ON public.food_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_log' AND policyname='food_log_insert_own') THEN
    CREATE POLICY food_log_insert_own ON public.food_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_log' AND policyname='food_log_update_own') THEN
    CREATE POLICY food_log_update_own ON public.food_log FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_log' AND policyname='food_log_delete_own') THEN
    CREATE POLICY food_log_delete_own ON public.food_log FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='health_samples' AND policyname='health_samples_select_own') THEN
    CREATE POLICY health_samples_select_own ON public.health_samples FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='health_samples' AND policyname='health_samples_insert_own') THEN
    CREATE POLICY health_samples_insert_own ON public.health_samples FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='health_samples' AND policyname='health_samples_update_own') THEN
    CREATE POLICY health_samples_update_own ON public.health_samples FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='health_samples' AND policyname='health_samples_delete_own') THEN
    CREATE POLICY health_samples_delete_own ON public.health_samples FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_scans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_samples TO authenticated;
GRANT ALL ON public.food_scans TO service_role;
GRANT ALL ON public.food_log TO service_role;
GRANT ALL ON public.health_samples TO service_role;

CREATE INDEX IF NOT EXISTS food_scans_user_created_idx ON public.food_scans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS food_log_user_date_idx ON public.food_log(user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS health_samples_user_ts_idx ON public.health_samples(user_id, ts DESC);

NOTIFY pgrst, 'reload schema';
