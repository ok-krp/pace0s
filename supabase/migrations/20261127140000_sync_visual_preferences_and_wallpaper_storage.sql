-- Account-level appearance sync for Web/PWA and native clients.
-- Theme and wallpaper metadata are small user_state values. Custom image bytes
-- live in a private Storage bucket and are referenced only by their object path.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pace-wallpapers',
  'pace-wallpapers',
  false,
  4194304,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "pace_wallpapers_select_own" ON storage.objects;
DROP POLICY IF EXISTS "pace_wallpapers_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "pace_wallpapers_update_own" ON storage.objects;
DROP POLICY IF EXISTS "pace_wallpapers_delete_own" ON storage.objects;

CREATE POLICY "pace_wallpapers_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'pace-wallpapers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

CREATE POLICY "pace_wallpapers_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'pace-wallpapers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

CREATE POLICY "pace_wallpapers_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'pace-wallpapers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
)
WITH CHECK (
  bucket_id = 'pace-wallpapers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

CREATE POLICY "pace_wallpapers_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'pace-wallpapers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

-- Allow only the small account appearance records through the existing
-- low-payload private Broadcast channel. The actual user_state value is still
-- fetched through the existing authenticated, user-scoped query.
CREATE OR REPLACE FUNCTION pace_private.broadcast_user_state_sync_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_key text;
  v_updated_at timestamptz;
BEGIN
  v_user_id := NEW.user_id;
  v_key := NEW.key;
  v_updated_at := NEW.updated_at;

  IF v_user_id IS NULL OR v_key IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_key LIKE 'lt.%' THEN
    v_key := 'pace.' || pg_catalog.substr(v_key, 4);
  END IF;

  IF v_key !~ '^pace[.]'
     OR v_key ~ '^pace[.]__'
     OR v_key ~ '^pace[.]domain[.]__'
     OR v_key ~ '^pace[.](privacy|finance|ble|import|local-ai)[.]'
     OR v_key ~ '^pace[.]domain[.](privacy|finance|ble|import|local-ai)[.]'
     OR v_key ~ '^pace[.]domain[.]ai[.](local[.]|debug|pending:)'
     OR v_key ~ '^pace[.]ai[.](local[.]|debug|pending:)'
     OR v_key = ANY (ARRAY[
       'pace.sport.active',
       'pace.legal.consent',
       'pace.billing.device_id',
       'pace.watch.last_metrics',
       'pace.ai.conversations',
       'pace.ai.deleted_conversations',
       'pace.domain.outbox',
       'pace.domain.sport.active',
       'pace.domain.legal.consent',
       'pace.domain.billing.device_id',
       'pace.domain.watch.last_metrics',
       'pace.domain.ai.conversations',
       'pace.domain.ai.deleted_conversations'
     ]) THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.send(
    pg_catalog.jsonb_build_object(
      'key', v_key,
      'updated_at', v_updated_at,
      'operation', TG_OP
    ),
    'user_state_changed',
    'pace-user-state:' || v_user_id::text,
    true
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION pace_private.broadcast_user_state_sync_event()
  FROM PUBLIC, anon, authenticated;
