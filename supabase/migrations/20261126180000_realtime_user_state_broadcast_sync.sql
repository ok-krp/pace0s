-- Low-payload, account-scoped notifications for cross-device user_state sync.
-- Broadcast only the key and server timestamp; clients fetch the JSONB value
-- through the existing user-scoped PostgREST query and its device-local filters.

CREATE SCHEMA IF NOT EXISTS pace_private;
REVOKE ALL ON SCHEMA pace_private FROM PUBLIC, anon, authenticated;

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

  -- Normalize legacy aliases so both clients can validate one canonical key.
  IF v_key LIKE 'lt.%' THEN
    v_key := 'pace.' || pg_catalog.substr(v_key, 4);
  END IF;

  -- Never announce device-only, private, local-AI, or internal state.
  IF v_key !~ '^pace\.'
     OR v_key ~ '^pace\.__'
     OR v_key ~ '^pace\.domain\.__'
     OR v_key ~ '^pace\.(privacy|finance|ble|import|local-ai)\.'
     OR v_key ~ '^pace\.domain\.(privacy|finance|ble|import|local-ai)\.'
     OR v_key ~ '^pace\.ai\.(local\.|debug|pending:)'
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
       'pace.domain.outbox'
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

DROP TRIGGER IF EXISTS user_state_broadcast_sync_event
  ON public.user_state;

CREATE TRIGGER user_state_broadcast_sync_event
  AFTER INSERT OR UPDATE ON public.user_state
  FOR EACH ROW
  EXECUTE FUNCTION pace_private.broadcast_user_state_sync_event();

DROP POLICY IF EXISTS pace_users_receive_own_sync_broadcasts
  ON realtime.messages;

CREATE POLICY pace_users_receive_own_sync_broadcasts
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() = 'pace-user-state:' || (SELECT auth.uid())::text
  );
