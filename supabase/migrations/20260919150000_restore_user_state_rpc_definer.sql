-- PACE — Restore server-authoritative user_state conflict resolution.
-- The RPC performs its own auth.uid() ownership check, so SECURITY DEFINER
-- lets the newest-wins mutation remain atomic without falling back to direct
-- PostgREST PATCH requests that can race and return 409 conflicts.

ALTER FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  SECURITY DEFINER;

ALTER FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  SET search_path = public;

REVOKE ALL ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

/*
Legacy SECURITY INVOKER override preserved for reference:

ALTER FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  SECURITY INVOKER;
*/
