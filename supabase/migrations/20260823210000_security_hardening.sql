-- Security hardening for exposed database functions.
-- User-state RPCs already enforce auth.uid() = p_user_id and operate on
-- user-owned tables protected by RLS, so SECURITY INVOKER is sufficient and
-- avoids granting SECURITY DEFINER execution to authenticated users.

ALTER FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  SECURITY INVOKER;

-- Trigger functions are implementation details and must never be callable by
-- API roles directly.
REVOKE EXECUTE ON FUNCTION public.touch_ai_provider_secret_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Keep the RPC callable only by authenticated users. SECURITY INVOKER means
-- its writes are evaluated against the caller's RLS policies.
REVOKE EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) TO authenticated;
