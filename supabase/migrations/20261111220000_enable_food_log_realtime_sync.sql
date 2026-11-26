-- Publish canonical Nutrition INSERT/UPDATE changes so Web and native clients
-- can reconcile AI/manual food_log mutations without waiting for a user_state write.
-- DELETE events are intentionally handled by the bounded client-side refresh:
-- Supabase Postgres Changes cannot filter DELETE by user_id, and RLS does not
-- apply to DELETE payloads. No REPLICA IDENTITY FULL change is required.

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
