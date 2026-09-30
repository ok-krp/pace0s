-- Restore the database contract required by the cloud-sync client.
-- The client reads user_state directly and listens to Supabase Realtime.
-- Writes remain authenticated through upsert_user_state_if_newer.

ALTER TABLE public.user_state REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'user_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_state;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
