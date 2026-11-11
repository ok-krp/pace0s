-- Minimal PostgreSQL fixture matching every relation and column used by
-- supabase/migrations/20261108200000_rls_hardening_review.sql.
-- Run only in a disposable CI database.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $auth_uid$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$auth_uid$;

CREATE TABLE public.ai_action_log (id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid);
CREATE TABLE public.ai_conversations (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.ai_messages (id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid NOT NULL);
CREATE TABLE public.ai_preferences (user_id uuid PRIMARY KEY);
CREATE TABLE public.ai_provider_secrets (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.ai_tool_idempotency (id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid NOT NULL);
CREATE TABLE public.audit_log (id uuid PRIMARY KEY);
CREATE TABLE public.billing_customers (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.billing_events (id uuid PRIMARY KEY);
CREATE TABLE public.billing_subscriptions (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.billing_trials (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  consent_type text NOT NULL,
  granted boolean NOT NULL,
  legal_version text NOT NULL,
  policy_version text NOT NULL,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.data_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz, error_code text, requested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.development_tasks (id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid);
CREATE TABLE public.food_log (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.food_scans (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.health_e2ee_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_name text NOT NULL DEFAULT 'Pace device',
  public_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  algorithm text NOT NULL DEFAULT 'ECDH-P256',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE TABLE public.health_e2ee_key_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  sender_device_id uuid,
  pairing_session_id uuid,
  envelope text NOT NULL DEFAULT 'cipher',
  nonce text NOT NULL,
  algorithm text NOT NULL DEFAULT 'ECDH-P256/AES-256-GCM',
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.health_e2ee_key_versions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  current_key_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.health_e2ee_pairing_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, initiator_device_id uuid NOT NULL, recipient_device_id uuid
);
CREATE TABLE public.health_e2ee_recovery_envelopes (
  user_id uuid PRIMARY KEY,
  envelope text NOT NULL,
  nonce text NOT NULL,
  algorithm text NOT NULL DEFAULT 'PBKDF2-SHA-256/AES-256-GCM',
  key_version integer NOT NULL CHECK (key_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (algorithm = 'PBKDF2-SHA-256/AES-256-GCM')
);
CREATE TABLE public.health_legacy_migration_map (legacy_sample_id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.health_samples (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.health_samples_e2ee (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, ciphertext text NOT NULL DEFAULT 'cipher',
  nonce text NOT NULL DEFAULT 'nonce', algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  key_version integer NOT NULL DEFAULT 1, dedupe_hash text
);
CREATE TABLE public.legal_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  region text NOT NULL CHECK (region IN ('EU','CA-US','BR','UK','CH','OTHER')),
  eula_version text NOT NULL,
  privacy_version text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip_country text,
  opts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, eula_version, privacy_version)
);
CREATE TABLE public.notification_log (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.nutrition_canonical_dishes (id uuid PRIMARY KEY);
CREATE TABLE public.nutrition_data_sources (id text PRIMARY KEY);
CREATE TABLE public.nutrition_dish_references (id uuid PRIMARY KEY);
CREATE TABLE public.nutrition_reference_dishes (id uuid PRIMARY KEY);
CREATE TABLE public.nutrition_reference_foods (id uuid PRIMARY KEY);
CREATE TABLE public.nutrition_reference_sources (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  display_name text,
  email text,
  age integer,
  sex text,
  height_cm numeric,
  weight_kg numeric,
  weight_goal_kg numeric,
  body_fat_goal_pct numeric,
  muscle_mass_goal_pct numeric,
  daily_calorie_goal integer,
  daily_protein_goal integer,
  daily_water_ml_goal integer,
  training_goal text,
  activity_level text,
  training_sessions_goal integer,
  updated_at timestamptz,
  updated_by text,
  UNIQUE (user_id)
);
CREATE TABLE public.push_subscriptions (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.reminder_debug_log (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.reminder_settings (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sport_exercises (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.sport_program_items (id uuid PRIMARY KEY, program_id uuid NOT NULL, exercise_id uuid NOT NULL);
CREATE TABLE public.sport_programs (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.sport_progression_targets (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, exercise_id uuid NOT NULL, based_on_session_id uuid
);
CREATE TABLE public.sport_workout_exercises (id uuid PRIMARY KEY, session_id uuid NOT NULL, exercise_id uuid NOT NULL);
CREATE TABLE public.sport_workout_sets (id uuid PRIMARY KEY, workout_exercise_id uuid NOT NULL);
CREATE TABLE public.sport_workout_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  program_id uuid,
  ended_at timestamptz,
  is_temporary boolean NOT NULL DEFAULT false
);
CREATE TABLE public.user_biometrics_e2ee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ciphertext text NOT NULL,
  nonce text NOT NULL,
  algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_state (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (user_id, key)
);

-- Minimal legacy SECURITY DEFINER routine stubs. The follow-up hardening
-- migration must empty their search_path and remove caller EXECUTE grants.
CREATE FUNCTION public.upsert_profile_if_newer(
  p_user_id uuid, p_profile jsonb, p_updated_at timestamptz, p_updated_by text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $profile_sync$
DECLARE accepted boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  INSERT INTO public.profiles(id,user_id,weight_kg,training_goal,updated_at,updated_by)
  VALUES (
    p_user_id,p_user_id,
    NULLIF(p_profile->>'weight_kg','')::numeric,
    p_profile->>'training_goal',
    p_updated_at,p_updated_by
  )
  ON CONFLICT (user_id) DO UPDATE SET
    weight_kg=EXCLUDED.weight_kg,
    training_goal=EXCLUDED.training_goal,
    updated_at=EXCLUDED.updated_at,
    updated_by=EXCLUDED.updated_by
  WHERE public.profiles.updated_at IS NULL OR EXCLUDED.updated_at > public.profiles.updated_at
  RETURNING true INTO accepted;
  RETURN COALESCE(accepted,false);
END;
$profile_sync$;
CREATE FUNCTION public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $routine$ SELECT '{}'::jsonb $routine$;
CREATE FUNCTION public.rotate_health_e2ee_key(
  p_new_key_version integer, p_revoked_device_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $routine$
DECLARE v_current_version integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_new_key_version <= 1 THEN RAISE EXCEPTION 'Invalid key version'; END IF;

  SELECT current_key_version INTO v_current_version
  FROM public.health_e2ee_key_versions
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_current_version IS NULL THEN
    v_current_version := 1;
    INSERT INTO public.health_e2ee_key_versions(user_id,current_key_version)
    VALUES (auth.uid(),1)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  IF p_new_key_version <> v_current_version + 1 THEN
    RAISE EXCEPTION 'Key version must advance exactly one step';
  END IF;

  IF p_revoked_device_id IS NOT NULL THEN
    UPDATE public.health_e2ee_devices
    SET revoked_at=coalesce(revoked_at,now())
    WHERE id=p_revoked_device_id AND user_id=auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'Device does not belong to current user'; END IF;
  END IF;

  UPDATE public.health_e2ee_key_versions
  SET current_key_version=p_new_key_version, updated_at=now()
  WHERE user_id=auth.uid();
END;
$routine$;
CREATE FUNCTION public.sync_sport_user_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $routine$ BEGIN RETURN NEW; END $routine$;
CREATE FUNCTION public.delete_temporary_workout_after_finish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $routine$ BEGIN RETURN NEW; END $routine$;
CREATE FUNCTION public.touch_ai_provider_secret_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $routine$ BEGIN RETURN NEW; END $routine$;
CREATE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $routine$ BEGIN RETURN NEW; END $routine$;
CREATE FUNCTION public.prevent_consent_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $routine$ BEGIN RETURN NEW; END $routine$;
CREATE FUNCTION public.set_deletion_request_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $routine$ BEGIN RETURN NEW; END $routine$;
CREATE FUNCTION public.delete_user_data(uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $routine$ BEGIN RETURN; END $routine$;
CREATE FUNCTION public.sync_sport_program_archive_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN RETURN NEW; END $routine$;
CREATE FUNCTION public.enforce_daily_nutrition_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN RETURN NEW; END $routine$;

CREATE FUNCTION public.sport_update_exercise(
  p_id uuid, p_name text DEFAULT NULL, p_muscle text DEFAULT NULL,
  p_equipment text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_default_sets integer DEFAULT NULL, p_default_reps integer DEFAULT NULL,
  p_default_weight numeric DEFAULT NULL, p_rest_sec integer DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $routine$ BEGIN
  UPDATE public.sport_exercises SET user_id=sport_exercises.user_id
  WHERE id=p_id AND user_id=(SELECT auth.uid());
  RETURN FOUND;
END $routine$;
CREATE FUNCTION public.sport_delete_exercise(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $routine$ BEGIN
  DELETE FROM public.sport_exercises WHERE id=p_id AND user_id=(SELECT auth.uid());
  RETURN FOUND;
END $routine$;
CREATE FUNCTION public.sport_update_program(
  p_id uuid, p_name text DEFAULT NULL, p_emoji text DEFAULT NULL, p_days integer[] DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $routine$ BEGIN
  UPDATE public.sport_programs SET user_id=sport_programs.user_id
  WHERE id=p_id AND user_id=(SELECT auth.uid());
  RETURN FOUND;
END $routine$;
CREATE FUNCTION public.sport_delete_program(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $routine$ BEGIN
  DELETE FROM public.sport_programs WHERE id=p_id AND user_id=(SELECT auth.uid());
  RETURN FOUND;
END $routine$;
CREATE FUNCTION public.sport_finish_workout(
  p_id uuid, p_ended_at timestamptz DEFAULT now(),
  p_duration_min integer DEFAULT NULL, p_notes text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $routine$ BEGIN
  UPDATE public.sport_workout_sessions SET ended_at=p_ended_at
  WHERE id=p_id AND user_id=(SELECT auth.uid());
  RETURN FOUND;
END $routine$;
CREATE FUNCTION public.sport_delete_workout(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $routine$ BEGIN
  DELETE FROM public.sport_workout_sessions WHERE id=p_id AND user_id=(SELECT auth.uid());
  RETURN FOUND;
END $routine$;
CREATE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $routine$ BEGIN NEW.updated_at=now(); RETURN NEW; END $routine$;
CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $routine$ BEGIN NEW.updated_at=now(); RETURN NEW; END $routine$;

CREATE FUNCTION public.create_pairing_session(
  p_initiator_device_id uuid,p_secret_hash text,p_challenge text,
  p_ephemeral_pub jsonb,p_expires_in_seconds integer DEFAULT 300
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN '81000000-0000-0000-0000-000000000001'::uuid;
END $routine$;
CREATE FUNCTION public.join_pairing_session(
  p_session_id uuid,p_secret_plaintext text,p_recipient_device_id uuid,p_ephemeral_pub jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
END $routine$;
CREATE FUNCTION public.confirm_pairing_session(p_session_id uuid,p_initiator_device_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
END $routine$;
CREATE FUNCTION public.complete_pairing_session(p_session_id uuid,p_recipient_device_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
END $routine$;
CREATE FUNCTION public.create_pairing_envelope(
  p_session_id uuid,p_sender_device_id uuid,p_recipient_device_id uuid,
  p_envelope text,p_key_version integer,p_algorithm text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN '82000000-0000-0000-0000-000000000001'::uuid;
END $routine$;
CREATE FUNCTION public.get_pairing_session(p_session_id uuid)
RETURNS TABLE (
  id uuid, initiator_device_id uuid, recipient_device_id uuid,
  protocol_version text, status text, challenge text,
  initiator_ephemeral_public_key jsonb, recipient_ephemeral_public_key jsonb,
  expires_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN;
END $routine$;
CREATE FUNCTION public.migrate_health_legacy_chunk(p_records jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN 0;
END $routine$;
CREATE FUNCTION public.backfill_health_e2ee_dedupe_hashes(p_updates jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $routine$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN 0;
END $routine$;

-- A real row trigger is attached before the follow-up migration revokes
-- direct EXECUTE on its SECURITY DEFINER function.
CREATE TRIGGER fixture_temporary_workout_trigger
AFTER UPDATE OF ended_at ON public.sport_workout_sessions
FOR EACH ROW
WHEN (NEW.ended_at IS NOT NULL AND NEW.is_temporary = true)
EXECUTE FUNCTION public.delete_temporary_workout_after_finish();

CREATE TRIGGER fixture_reminder_timestamp_trigger
BEFORE UPDATE ON public.reminder_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER fixture_legal_consent_timestamp_trigger
BEFORE UPDATE ON public.legal_consent
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Simulate broad legacy grants, including PUBLIC-inherited grants.
CREATE SEQUENCE public.fixture_public_sequence;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON public.ai_provider_secrets TO PUBLIC;
GRANT ALL PRIVILEGES ON SEQUENCE public.fixture_public_sequence TO PUBLIC;
-- A column-only grant survives a table-level REVOKE unless it is handled
-- explicitly by the RLS migration.
GRANT SELECT (user_id), INSERT (user_id), UPDATE (user_id)
  ON public.ai_provider_secrets TO PUBLIC, anon, authenticated;
CREATE POLICY fixture_stale_profiles_select ON public.profiles
  FOR SELECT TO authenticated USING (true);
