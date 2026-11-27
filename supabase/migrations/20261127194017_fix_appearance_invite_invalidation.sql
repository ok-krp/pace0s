-- Mark superseded one-time invitation hashes as consumed.
-- The expires_at > created_at constraint intentionally remains strict.
CREATE OR REPLACE FUNCTION public.create_appearance_share_invite()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_token text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.legal_consent AS lc
    WHERE lc.user_id = v_user_id
      AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'cloud_sync_consent_required' USING ERRCODE = '42501';
  END IF;

  IF (
    SELECT count(*)
    FROM pace_private.appearance_shares AS s
    WHERE s.owner_user_id = v_user_id
      AND s.revoked_at IS NULL
  ) >= 10 THEN
    RAISE EXCEPTION 'appearance_share_limit_reached' USING ERRCODE = '54000';
  END IF;

  UPDATE pace_private.appearance_share_invites
  SET consumed_at = pg_catalog.now()
  WHERE owner_user_id = v_user_id
    AND consumed_at IS NULL
    AND expires_at > pg_catalog.now();

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO pace_private.appearance_share_invites (
    token_hash,
    owner_user_id,
    expires_at
  )
  VALUES (
    extensions.digest(v_token, 'sha256'),
    v_user_id,
    pg_catalog.now() + interval '24 hours'
  );

  RETURN v_token;
END;
$function$;

-- Same constraint-safe invalidation when either party withdraws cloud consent.
CREATE OR REPLACE FUNCTION pace_private.broadcast_shared_appearance_consent_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_share record;
BEGIN
  IF COALESCE((OLD.opts ->> 'sync_cloud')::boolean, false)
     AND NOT COALESCE((NEW.opts ->> 'sync_cloud')::boolean, false) THEN

    UPDATE pace_private.appearance_share_invites
    SET consumed_at = pg_catalog.now()
    WHERE owner_user_id = NEW.user_id
      AND consumed_at IS NULL
      AND expires_at > pg_catalog.now();

    FOR v_share IN
      SELECT s.owner_user_id, s.recipient_user_id
      FROM pace_private.appearance_shares AS s
      WHERE s.revoked_at IS NULL
        AND (
          s.owner_user_id = NEW.user_id
          OR s.recipient_user_id = NEW.user_id
        )
      FOR UPDATE
    LOOP
      UPDATE pace_private.appearance_shares AS s
      SET revoked_at = pg_catalog.now(),
          revoked_by = NEW.user_id
      WHERE s.owner_user_id = v_share.owner_user_id
        AND s.recipient_user_id = v_share.recipient_user_id
        AND s.revoked_at IS NULL;

      PERFORM realtime.send(
        pg_catalog.jsonb_build_object(
          'owner_user_id', v_share.owner_user_id,
          'operation', 'consent_revoked'
        ),
        'shared_appearance_changed',
        'pace-appearance-share:' || v_share.recipient_user_id::text,
        true
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_appearance_share_invite()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appearance_share_invite()
  TO authenticated;
REVOKE ALL ON FUNCTION pace_private.broadcast_shared_appearance_consent_revocation()
  FROM PUBLIC, anon, authenticated;
