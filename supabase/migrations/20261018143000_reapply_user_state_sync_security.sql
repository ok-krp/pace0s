-- Reapply the conflict-safe native sync RPC for environments that already
-- recorded the historical 20260815000000_sync_conflict_resolution migration.
--
-- Editing an applied migration does not update existing databases. This
-- follow-up deliberately reinstalls the same guarded function without
-- changing application data. It must be reviewed and applied through the
-- normal migration process; it is NOT applied to production by this PR.

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
SET search_path = ''
AS $$
DECLARE
  affected_rows bigint;
BEGIN
  -- The caller may only mutate rows belonging to the authenticated account.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.user_state (user_id, key, value, updated_at, updated_by)
  VALUES (p_user_id, p_key, p_value, p_updated_at, p_updated_by)
  ON CONFLICT (user_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
  WHERE public.user_state.updated_at < EXCLUDED.updated_at;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text)
  TO authenticated;
