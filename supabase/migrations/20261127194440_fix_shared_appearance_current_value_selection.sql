-- Always share the latest saved appearance preference, independent of whether it
-- currently lives in the canonical key or a domain/legacy envelope.
-- Storage access is limited to the exact latest custom wallpaper object.
-- Deleting a preference also broadcasts a refresh to active recipients.

CREATE OR REPLACE FUNCTION public.get_shared_appearance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_recipient_id uuid := auth.uid();
  v_owner_id uuid;
  v_theme jsonb;
  v_dark jsonb;
  v_wallpaper jsonb;
  v_theme_updated_at timestamptz;
  v_dark_updated_at timestamptz;
  v_wallpaper_updated_at timestamptz;
BEGIN
  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.legal_consent AS lc
    WHERE lc.user_id = v_recipient_id
      AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
  ) THEN RETURN NULL; END IF;
  SELECT s.owner_user_id INTO v_owner_id
  FROM pace_private.appearance_shares AS s
  WHERE s.recipient_user_id = v_recipient_id AND s.revoked_at IS NULL
  LIMIT 1;
  IF v_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.legal_consent AS lc
    WHERE lc.user_id = v_owner_id
      AND COALESCE((lc.opts ->> 'sync_cloud')::boolean, false)
  ) THEN RETURN NULL; END IF;

  SELECT us.value, us.updated_at INTO v_theme, v_theme_updated_at
  FROM public.user_state AS us
  WHERE us.user_id = v_owner_id
    AND us.key IN ('pace.visual-theme','pace.domain.visual-theme','lt.visual-theme','lt.domain.visual-theme')
  ORDER BY us.updated_at DESC,
    CASE us.key WHEN 'pace.visual-theme' THEN 0 WHEN 'pace.domain.visual-theme' THEN 1
      WHEN 'lt.visual-theme' THEN 2 ELSE 3 END
  LIMIT 1;

  SELECT us.value, us.updated_at INTO v_dark, v_dark_updated_at
  FROM public.user_state AS us
  WHERE us.user_id = v_owner_id
    AND us.key IN ('pace.dark','pace.domain.dark','lt.dark','lt.domain.dark')
  ORDER BY us.updated_at DESC,
    CASE us.key WHEN 'pace.dark' THEN 0 WHEN 'pace.domain.dark' THEN 1
      WHEN 'lt.dark' THEN 2 ELSE 3 END
  LIMIT 1;

  SELECT us.value, us.updated_at INTO v_wallpaper, v_wallpaper_updated_at
  FROM public.user_state AS us
  WHERE us.user_id = v_owner_id
    AND us.key IN ('pace.wallpaper','pace.domain.wallpaper','lt.wallpaper','lt.domain.wallpaper')
  ORDER BY us.updated_at DESC,
    CASE us.key WHEN 'pace.wallpaper' THEN 0 WHEN 'pace.domain.wallpaper' THEN 1
      WHEN 'lt.wallpaper' THEN 2 ELSE 3 END
  LIMIT 1;

  RETURN pg_catalog.jsonb_build_object(
    'ownerUserId', v_owner_id,
    'visualTheme', v_theme,
    'dark', v_dark,
    'wallpaper', v_wallpaper,
    'updatedAt', GREATEST(
      COALESCE(v_theme_updated_at, 'epoch'::timestamptz),
      COALESCE(v_dark_updated_at, 'epoch'::timestamptz),
      COALESCE(v_wallpaper_updated_at, 'epoch'::timestamptz)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pace_can_read_shared_wallpaper(
  p_object_name text, p_recipient_id uuid
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
  v_wallpaper jsonb;
BEGIN
  IF p_object_name IS NULL OR p_recipient_id IS NULL
     OR auth.uid() IS DISTINCT FROM p_recipient_id THEN RETURN false; END IF;
  v_owner_text := pg_catalog.split_part(p_object_name, '/', 1);
  v_file_name := pg_catalog.split_part(p_object_name, '/', 2);
  IF v_owner_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_file_name !~ '^[A-Za-z0-9._-]+[.](jpg|png|webp)$'
     OR pg_catalog.split_part(p_object_name, '/', 3) <> '' THEN RETURN false; END IF;
  v_owner_id := v_owner_text::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM pace_private.appearance_shares AS s
    WHERE s.owner_user_id = v_owner_id AND s.recipient_user_id = p_recipient_id
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
  ) THEN RETURN false; END IF;

  SELECT us.value INTO v_wallpaper
  FROM public.user_state AS us
  WHERE us.user_id = v_owner_id
    AND us.key IN ('pace.wallpaper','pace.domain.wallpaper','lt.wallpaper','lt.domain.wallpaper')
  ORDER BY us.updated_at DESC,
    CASE us.key WHEN 'pace.wallpaper' THEN 0 WHEN 'pace.domain.wallpaper' THEN 1
      WHEN 'lt.wallpaper' THEN 2 ELSE 3 END
  LIMIT 1;

  RETURN COALESCE(
    pg_catalog.jsonb_path_exists(
      v_wallpaper,
      '$.**.storagePath ? (@ == $path)'::jsonpath,
      pg_catalog.jsonb_build_object('path', pg_catalog.to_jsonb(p_object_name))
    ),
    false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION pace_private.broadcast_shared_appearance_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid;
  v_key text;
  v_updated_at timestamptz;
  v_recipient_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
    v_key := OLD.key;
    v_updated_at := OLD.updated_at;
  ELSE
    v_user_id := NEW.user_id;
    v_key := NEW.key;
    v_updated_at := NEW.updated_at;
  END IF;
  IF v_user_id IS NULL OR v_key IS NULL THEN RETURN NULL; END IF;
  IF v_key LIKE 'lt.%' THEN v_key := 'pace.' || pg_catalog.substr(v_key, 4); END IF;
  IF v_key NOT IN (
    'pace.visual-theme','pace.dark','pace.wallpaper',
    'pace.domain.visual-theme','pace.domain.dark','pace.domain.wallpaper'
  ) THEN RETURN NULL; END IF;

  FOR v_recipient_id IN
    SELECT s.recipient_user_id
    FROM pace_private.appearance_shares AS s
    WHERE s.owner_user_id = v_user_id AND s.revoked_at IS NULL
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
        'owner_user_id', v_user_id, 'key', v_key,
        'updated_at', v_updated_at, 'operation', TG_OP
      ),
      'shared_appearance_changed',
      'pace-appearance-share:' || v_recipient_id::text,
      true
    );
  END LOOP;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS pace_broadcast_shared_appearance_event ON public.user_state;
CREATE TRIGGER pace_broadcast_shared_appearance_event
AFTER INSERT OR UPDATE OR DELETE ON public.user_state
FOR EACH ROW EXECUTE FUNCTION pace_private.broadcast_shared_appearance_event();

REVOKE ALL ON FUNCTION public.pace_can_read_shared_wallpaper(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pace_can_read_shared_wallpaper(text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION pace_private.broadcast_shared_appearance_event() FROM PUBLIC, anon, authenticated;
