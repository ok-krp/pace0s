-- Harden key filtering against non-standard-conforming string settings.
-- Use PostgreSQL character classes instead of backslash-escaped regex dots.
-- Limit read authorization to Broadcast messages on the authenticated user's own topic.

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

  -- Normalize legacy aliases so both clients validate one canonical key.
  IF v_key LIKE 'lt.%' THEN
    v_key := 'pace.' || pg_catalog.substr(v_key, 4);
  END IF;

  -- Never announce device-local, private, internal, or local-AI state.
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
       'pace.dark',
       'pace.visual-theme',
       'pace.wallpaper',
       'pace.domain.wallpaper',
       'pace.domain.outbox',
       'pace.domain.sport.active',
       'pace.domain.legal.consent',
       'pace.domain.billing.device_id',
       'pace.domain.watch.last_metrics',
       'pace.domain.ai.conversations',
       'pace.domain.ai.deleted_conversations',
       'pace.domain.dark',
       'pace.domain.visual-theme'
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

DROP POLICY IF EXISTS pace_users_receive_own_sync_broadcasts
  ON realtime.messages;

CREATE POLICY pace_users_receive_own_sync_broadcasts
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() = 'pace-user-state:' || (SELECT auth.uid())::text
  );
