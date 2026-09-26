-- Make user_state writes monotonic by database commit time.
CREATE OR REPLACE FUNCTION public.upsert_user_state_if_newer(
  p_user_id uuid,
  p_key text,
  p_value jsonb,
  p_updated_at timestamptz,
  p_updated_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  server_now timestamptz := clock_timestamp();
  committed_at timestamptz;
  accepted boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_key IS NULL OR p_key = '' THEN RAISE EXCEPTION 'key is required'; END IF;
  IF p_updated_by IS NULL OR length(trim(p_updated_by)) = 0 THEN RAISE EXCEPTION 'updated_by is required'; END IF;

  INSERT INTO public.user_state (user_id, key, value, updated_at, updated_by)
  VALUES (p_user_id, p_key, p_value, server_now, p_updated_by)
  ON CONFLICT (user_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
    WHERE public.user_state.updated_at < EXCLUDED.updated_at
  RETURNING updated_at INTO committed_at;

  IF FOUND THEN
    accepted := true;
  ELSE
    SELECT updated_at
      INTO committed_at
      FROM public.user_state
     WHERE user_id = p_user_id
       AND key = p_key;
  END IF;

  RETURN jsonb_build_object('accepted', accepted, 'updated_at', committed_at);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
