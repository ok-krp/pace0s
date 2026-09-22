-- Make cloud-state ordering server-authoritative and enable E2EE health realtime.
DROP FUNCTION IF EXISTS public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text);

CREATE FUNCTION public.upsert_user_state_if_newer(
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
  current_row public.user_state%ROWTYPE;
  accepted boolean := false;
  committed_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_key IS NULL OR p_key = '' THEN
    RAISE EXCEPTION 'key is required';
  END IF;
  IF p_updated_by IS NULL OR length(trim(p_updated_by)) = 0 THEN
    RAISE EXCEPTION 'updated_by is required';
  END IF;

  SELECT *
    INTO current_row
    FROM public.user_state
   WHERE user_id = p_user_id
     AND key = p_key
   FOR UPDATE;

  IF current_row IS NULL THEN
    INSERT INTO public.user_state (user_id, key, value, updated_at, updated_by)
    VALUES (p_user_id, p_key, p_value, server_now, p_updated_by)
    RETURNING updated_at INTO committed_at;
    accepted := true;
  ELSIF server_now > COALESCE(current_row.updated_at, to_timestamp(0)) THEN
    UPDATE public.user_state
       SET value = p_value,
           updated_at = server_now,
           updated_by = p_updated_by
     WHERE user_id = p_user_id
       AND key = p_key
    RETURNING updated_at INTO committed_at;
    accepted := true;
  ELSE
    committed_at := current_row.updated_at;
  END IF;

  RETURN jsonb_build_object(
    'accepted', accepted,
    'updated_at', committed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) TO authenticated;

ALTER TABLE public.health_samples_e2ee REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'health_samples_e2ee'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.health_samples_e2ee;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
