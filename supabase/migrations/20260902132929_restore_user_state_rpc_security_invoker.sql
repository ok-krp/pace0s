ALTER FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  SECURITY INVOKER;
