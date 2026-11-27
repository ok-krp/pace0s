-- Secure, opt-in, one-way appearance sharing between different Pace accounts.
-- Only the active theme, dark-mode preference and current wallpaper reference
-- are exposed. No profile, health, nutrition, finance or general user_state rows
-- are made readable by a recipient.

CREATE TABLE IF NOT EXISTS pace_private.appearance_share_invites (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT appearance_share_invites_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS appearance_share_invites_owner_idx
  ON pace_private.appearance_share_invites (owner_user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS pace_private.appearance_shares (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (owner_user_id, recipient_user_id),
  CONSTRAINT appearance_shares_not_self_check
    CHECK (owner_user_id <> recipient_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS appearance_shares_one_source_per_recipient_idx
  ON pace_private.appearance_shares (recipient_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS appearance_shares_owner_active_idx
  ON pace_private.appearance_shares (owner_user_id, recipient_user_id)
  WHERE revoked_at IS NULL;

REVOKE ALL ON TABLE pace_private.appearance_share_invites
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE pace_private.appearance_shares
  FROM PUBLIC, anon, authenticated;

-- The owner generates a single-use, 256-bit invitation. Only its SHA-256 hash
-- is stored; the clear token is returned once and expires after 24 hours.
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
  SET expires_at = pg_catalog.now()
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

-- Accepting an invite requires the recipient to be authenticated and to have
-- independently enabled cloud sync. Each recipient can follow only one source.
CREATE OR REPLACE FUNCTION public.accept_appearance_share_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_recipient_id uuid := auth.uid();
  v_invite pace_private.appearance_share_invites%ROWTYPE;
BEGIN
  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;

  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_or_expired_appearance_invite' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.legal_consent AS lc
    WHERE lc.user_id = v_recipient_id
      AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'cloud_sync_consent_required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_invite
  FROM pace_private.appearance_share_invites AS i
  WHERE i.token_hash = extensions.digest(p_token, 'sha256')
    AND i.consumed_at IS NULL
    AND i.expires_at > pg_catalog.now()
  FOR UPDATE;

  IF NOT FOUND OR v_invite.owner_user_id = v_recipient_id THEN
    RAISE EXCEPTION 'invalid_or_expired_appearance_invite' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.legal_consent AS lc
    WHERE lc.user_id = v_invite.owner_user_id
      AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'share_owner_cloud_sync_consent_missing' USING ERRCODE = '42501';
  END IF;

  BEGIN
    INSERT INTO pace_private.appearance_shares (
      owner_user_id,
      recipient_user_id,
      revoked_at,
      revoked_by
    )
    VALUES (
      v_invite.owner_user_id,
      v_recipient_id,
      NULL,
      NULL
    )
    ON CONFLICT (owner_user_id, recipient_user_id)
    DO UPDATE SET
      revoked_at = NULL,
      revoked_by = NULL;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'recipient_already_follows_another_appearance_source'
        USING ERRCODE = '23505';
  END;

  UPDATE pace_private.appearance_share_invites
  SET consumed_at = pg_catalog.now()
  WHERE id = v_invite.id;

  RETURN v_invite.owner_user_id;
END;
$function$;

-- Returns only the three allow-listed settings for the single active source.
CREATE OR REPLACE FUNCTION public.get_shared_appearance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_recipient_id uuid := auth.uid();
  v_owner_id uuid;
  v_result jsonb;
BEGIN
  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.legal_consent AS lc
    WHERE lc.user_id = v_recipient_id
      AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT s.owner_user_id
  INTO v_owner_id
  FROM pace_private.appearance_shares AS s
  WHERE s.recipient_user_id = v_recipient_id
    AND s.revoked_at IS NULL
  LIMIT 1;

  IF v_owner_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.legal_consent AS lc
    WHERE lc.user_id = v_owner_id
      AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'ownerUserId', v_owner_id,
    'visualTheme', (
      SELECT us.value
      FROM public.user_state AS us
      WHERE us.user_id = v_owner_id
        AND us.key IN ('pace.visual-theme', 'pace.domain.visual-theme', 'lt.visual-theme')
      ORDER BY CASE us.key
        WHEN 'pace.visual-theme' THEN 0
        WHEN 'pace.domain.visual-theme' THEN 1
        ELSE 2
      END, us.updated_at DESC
      LIMIT 1
    ),
    'dark', (
      SELECT us.value
      FROM public.user_state AS us
      WHERE us.user_id = v_owner_id
        AND us.key IN ('pace.dark', 'pace.domain.dark', 'lt.dark')
      ORDER BY CASE us.key
        WHEN 'pace.dark' THEN 0
        WHEN 'pace.domain.dark' THEN 1
        ELSE 2
      END, us.updated_at DESC
      LIMIT 1
    ),
    'wallpaper', (
      SELECT us.value
      FROM public.user_state AS us
      WHERE us.user_id = v_owner_id
        AND us.key IN ('pace.wallpaper', 'pace.domain.wallpaper', 'lt.wallpaper')
      ORDER BY CASE us.key
        WHEN 'pace.wallpaper' THEN 0
        WHEN 'pace.domain.wallpaper' THEN 1
        ELSE 2
      END, us.updated_at DESC
      LIMIT 1
    ),
    'updatedAt', GREATEST(
      COALESCE((
        SELECT us.updated_at FROM public.user_state AS us
        WHERE us.user_id = v_owner_id
          AND us.key IN ('pace.visual-theme', 'pace.domain.visual-theme', 'lt.visual-theme')
        ORDER BY us.updated_at DESC LIMIT 1
      ), 'epoch'::timestamptz),
      COALESCE((
        SELECT us.updated_at FROM public.user_state AS us
        WHERE us.user_id = v_owner_id
          AND us.key IN ('pace.dark', 'pace.domain.dark', 'lt.dark')
        ORDER BY us.updated_at DESC LIMIT 1
      ), 'epoch'::timestamptz),
      COALESCE((
        SELECT us.updated_at FROM public.user_state AS us
        WHERE us.user_id = v_owner_id
          AND us.key IN ('pace.wallpaper', 'pace.domain.wallpaper', 'lt.wallpaper')
        ORDER BY us.updated_at DESC LIMIT 1
      ), 'epoch'::timestamptz)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_appearance_shares()
RETURNS TABLE (
  direction text,
  other_user_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT 'outgoing'::text, s.recipient_user_id, s.created_at
  FROM pace_private.appearance_shares AS s
  WHERE s.owner_user_id = v_user_id AND s.revoked_at IS NULL
  UNION ALL
  SELECT 'incoming'::text, s.owner_user_id, s.created_at
  FROM pace_private.appearance_shares AS s
  WHERE s.recipient_user_id = v_user_id AND s.revoked_at IS NULL;
END;
$function$;

-- Either side can revoke/leave. A recipient event is sent so the receiving
-- client can immediately remove the remote appearance overlay.
CREATE OR REPLACE FUNCTION public.revoke_appearance_share(p_other_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_recipient_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;

  UPDATE pace_private.appearance_shares AS s
  SET revoked_at = pg_catalog.now(),
      revoked_by = v_user_id
  WHERE s.revoked_at IS NULL
    AND (
      (s.owner_user_id = v_user_id AND s.recipient_user_id = p_other_user_id)
      OR
      (s.recipient_user_id = v_user_id AND s.owner_user_id = p_other_user_id)
    )
  RETURNING s.owner_user_id, s.recipient_user_id
  INTO v_owner_id, v_recipient_id;

  IF v_recipient_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM realtime.send(
    pg_catalog.jsonb_build_object(
      'owner_user_id', v_owner_id,
      'operation', 'share_revoked'
    ),
    'shared_appearance_changed',
    'pace-appearance-share:' || v_recipient_id::text,
    true
  );

  RETURN true;
END;
$function$;

-- This helper permits a recipient to download exactly the current custom
-- wallpaper referenced by the owner's allow-listed wallpaper preference.
-- Other objects in the owner's private folder remain inaccessible.
CREATE OR REPLACE FUNCTION public.pace_can_read_shared_wallpaper(
  p_object_name text,
  p_recipient_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_text text;
  v_file_name text;
  v_owner_id uuid;
BEGIN
  IF p_recipient_id IS NULL OR auth.uid() IS DISTINCT FROM p_recipient_id THEN
    RETURN false;
  END IF;

  v_owner_text := pg_catalog.split_part(p_object_name, '/', 1);
  v_file_name := pg_catalog.split_part(p_object_name, '/', 2);

  IF v_owner_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_file_name !~ '^[A-Za-z0-9._-]+\.(jpg|png|webp)$'
     OR pg_catalog.split_part(p_object_name, '/', 3) <> '' THEN
    RETURN false;
  END IF;

  v_owner_id := v_owner_text::uuid;

  RETURN EXISTS (
    SELECT 1
    FROM pace_private.appearance_shares AS s
    WHERE s.owner_user_id = v_owner_id
      AND s.recipient_user_id = p_recipient_id
      AND s.revoked_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.legal_consent AS lc
        WHERE lc.user_id = s.owner_user_id
          AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
      )
      AND EXISTS (
        SELECT 1
        FROM public.legal_consent AS lc
        WHERE lc.user_id = s.recipient_user_id
          AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
      )
      AND EXISTS (
        SELECT 1
        FROM public.user_state AS us
        WHERE us.user_id = v_owner_id
          AND us.key IN ('pace.wallpaper', 'pace.domain.wallpaper', 'lt.wallpaper')
          AND pg_catalog.jsonb_path_exists(
            us.value,
            '$.**.storagePath ? (@ == $path)'::jsonpath,
            pg_catalog.jsonb_build_object('path', pg_catalog.to_jsonb(p_object_name))
          )
      )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pace_can_read_shared_wallpaper(text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pace_can_read_shared_wallpaper(text, uuid)
  TO authenticated;

DROP POLICY IF EXISTS "pace_wallpapers_select_shared_appearance" ON storage.objects;
CREATE POLICY "pace_wallpapers_select_shared_appearance"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'pace-wallpapers'
  AND public.pace_can_read_shared_wallpaper(name, (SELECT auth.uid()))
);

-- Keep recipients informed without publishing the underlying preference or
-- image. The recipient then calls get_shared_appearance() through its own JWT.
CREATE OR REPLACE FUNCTION pace_private.broadcast_shared_appearance_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_key text := NEW.key;
  v_recipient_id uuid;
BEGIN
  IF v_key LIKE 'lt.%' THEN
    v_key := 'pace.' || pg_catalog.substr(v_key, 4);
  END IF;

  IF v_key NOT IN (
    'pace.visual-theme',
    'pace.dark',
    'pace.wallpaper',
    'pace.domain.visual-theme',
    'pace.domain.dark',
    'pace.domain.wallpaper'
  ) THEN
    RETURN NULL;
  END IF;

  FOR v_recipient_id IN
    SELECT s.recipient_user_id
    FROM pace_private.appearance_shares AS s
    WHERE s.owner_user_id = NEW.user_id
      AND s.revoked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.legal_consent AS lc
        WHERE lc.user_id = s.owner_user_id
          AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
      )
      AND EXISTS (
        SELECT 1 FROM public.legal_consent AS lc
        WHERE lc.user_id = s.recipient_user_id
          AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
      )
  LOOP
    PERFORM realtime.send(
      pg_catalog.jsonb_build_object(
        'owner_user_id', NEW.user_id,
        'key', v_key,
        'updated_at', NEW.updated_at,
        'operation', TG_OP
      ),
      'shared_appearance_changed',
      'pace-appearance-share:' || v_recipient_id::text,
      true
    );
  END LOOP;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS pace_broadcast_shared_appearance_event
  ON public.user_state;
CREATE TRIGGER pace_broadcast_shared_appearance_event
AFTER INSERT OR UPDATE ON public.user_state
FOR EACH ROW
EXECUTE FUNCTION pace_private.broadcast_shared_appearance_event();

CREATE OR REPLACE FUNCTION pace_private.broadcast_shared_appearance_consent_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_recipient_id uuid;
BEGIN
  IF COALESCE((OLD.opts ->> 'sync_cloud')::boolean, false)
     AND NOT COALESCE((NEW.opts ->> 'sync_cloud')::boolean, false) THEN
    FOR v_recipient_id IN
      SELECT s.recipient_user_id
      FROM pace_private.appearance_shares AS s
      WHERE s.owner_user_id = NEW.user_id
        AND s.revoked_at IS NULL
    LOOP
      PERFORM realtime.send(
        pg_catalog.jsonb_build_object(
          'owner_user_id', NEW.user_id,
          'operation', 'consent_revoked'
        ),
        'shared_appearance_changed',
        'pace-appearance-share:' || v_recipient_id::text,
        true
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pace_broadcast_shared_appearance_consent_revocation
  ON public.legal_consent;
CREATE TRIGGER pace_broadcast_shared_appearance_consent_revocation
AFTER UPDATE OF opts ON public.legal_consent
FOR EACH ROW
EXECUTE FUNCTION pace_private.broadcast_shared_appearance_consent_revocation();

DROP POLICY IF EXISTS pace_users_receive_shared_appearance_events
  ON realtime.messages;
CREATE POLICY pace_users_receive_shared_appearance_events
ON realtime.messages FOR SELECT TO authenticated
USING (
  extension = 'broadcast'
  AND realtime.topic() = 'pace-appearance-share:' || (SELECT auth.uid())::text
);

REVOKE ALL ON FUNCTION public.create_appearance_share_invite() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_appearance_share_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_shared_appearance() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_appearance_shares() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_appearance_share(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_appearance_share_invite() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_appearance_share_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_appearance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_appearance_shares() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_appearance_share(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_shared_appearance() IS
  'Returns only the explicitly shared visual theme, dark mode and current wallpaper preference for the authenticated recipient.';
COMMENT ON FUNCTION public.pace_can_read_shared_wallpaper(text, uuid) IS
  'Storage RLS helper granting a recipient access only to the current custom wallpaper object of an active appearance share.';
