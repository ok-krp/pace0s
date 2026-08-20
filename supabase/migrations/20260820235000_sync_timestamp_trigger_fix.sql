-- PACE — Cloud sync timestamp correctness
--
-- Root cause: user_state has a BEFORE UPDATE trigger that always replaced
-- the timestamp supplied by the sync RPC with now(). That defeats the
-- client-side conflict rule (newest updated_at wins), can make an accepted
-- remote write look newer than the local write, and can contribute to
-- repeated sync/reconciliation loops.

-- 1. Preserve an explicitly supplied updated_at.
--    Normal updates that do not change updated_at still receive now().
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Re-apply the conflict-safe RPC with a defensive timestamp fallback.
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
  effective_updated_at timestamptz := COALESCE(p_updated_at, now());
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_key IS NULL OR p_key = '' THEN
    RAISE EXCEPTION 'key is required';
  END IF;

  INSERT INTO public.user_state (user_id, key, value, updated_at, updated_by)
  VALUES (p_user_id, p_key, p_value, effective_updated_at, p_updated_by)
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

-- 3. Keep Realtime enabled for actual cross-device changes.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_state;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.user_state REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
