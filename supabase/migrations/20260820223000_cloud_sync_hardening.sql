-- PACE — Cloud sync hardening
-- Idempotent repair for the RPC and Realtime configuration used by the web client.

ALTER TABLE public.user_state
  ADD COLUMN IF NOT EXISTS updated_by text;

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
  accepted boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_key IS NULL OR p_key = '' THEN
    RAISE EXCEPTION 'key is required';
  END IF;

  INSERT INTO public.user_state (user_id, key, value, updated_at, updated_by)
  VALUES (p_user_id, p_key, p_value, p_updated_at, p_updated_by)
  ON CONFLICT (user_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
    WHERE public.user_state.updated_at IS NULL
       OR EXCLUDED.updated_at > public.user_state.updated_at
  RETURNING true INTO accepted;

  RETURN COALESCE(accepted, false);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_state;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.user_state REPLICA IDENTITY FULL;
NOTIFY pgrst, 'reload schema';
