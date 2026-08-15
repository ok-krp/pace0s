-- PaceOS conflict-safe sync write.
-- The timestamp check happens inside PostgreSQL so concurrent devices cannot
-- overwrite a newer row merely because both clients used upsert at once.

CREATE OR REPLACE FUNCTION public.upsert_user_state_if_newer(
  p_user_id uuid,
  p_key text,
  p_value jsonb,
  p_updated_at timestamptz,
  p_updated_by text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_updated_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT updated_at INTO current_updated_at
    FROM public.user_state
   WHERE user_id = p_user_id AND key = p_key
   FOR UPDATE;

  IF current_updated_at IS NOT NULL AND current_updated_at >= p_updated_at THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_state (user_id, key, value, updated_at, updated_by)
  VALUES (p_user_id, p_key, p_value, p_updated_at, p_updated_by)
  ON CONFLICT (user_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) TO authenticated;
