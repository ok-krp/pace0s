-- Publish canonical Nutrition changes so Web and native clients can
-- reconcile AI/manual food_log mutations without waiting for a user_state write.
-- FULL replica identity is required for account-filtered DELETE events because
-- Postgres otherwise exposes only the primary key in the old-row payload.
ALTER TABLE public.food_log REPLICA IDENTITY FULL;

-- This migration is additive and idempotent. It is intentionally not applied
-- to any Supabase environment as part of this PR.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.food_log;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;
