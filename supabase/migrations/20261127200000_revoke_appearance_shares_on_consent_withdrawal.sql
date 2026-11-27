-- Consent withdrawal permanently revokes appearance-sharing relationships.
-- Re-enabling cloud sync later must not silently restore access.
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

    -- Unused codes must not become valid again if consent is re-enabled.
    UPDATE pace_private.appearance_share_invites
    SET expires_at = LEAST(expires_at, pg_catalog.now())
    WHERE owner_user_id = NEW.user_id
      AND consumed_at IS NULL
      AND expires_at > pg_catalog.now();

    -- Either endpoint withdrawing sync consent permanently revokes the link.
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

REVOKE ALL ON FUNCTION pace_private.broadcast_shared_appearance_consent_revocation()
  FROM PUBLIC, anon, authenticated;
