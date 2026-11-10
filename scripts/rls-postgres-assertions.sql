-- Integration assertions. Migration is applied before this file.
\set ON_ERROR_STOP on

DO $fixture_seed$
BEGIN
  INSERT INTO public.profiles (id,user_id) VALUES
    ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('10000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.health_samples (id,user_id) VALUES
    ('20000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('20000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.ai_conversations (id,user_id) VALUES
    ('30000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('30000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.sport_programs (id,user_id) VALUES
    ('40000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('40000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.sport_exercises (id,user_id) VALUES
    ('50000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('50000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.sport_workout_sessions (id,user_id,program_id) VALUES
    ('60000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','40000000-0000-0000-0000-000000000001'),
    ('60000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','40000000-0000-0000-0000-000000000002');
  INSERT INTO public.health_e2ee_devices (id,user_id) VALUES
    ('70000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('70000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.health_e2ee_pairing_sessions (id,user_id,initiator_device_id) VALUES
    ('80000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','70000000-0000-0000-0000-000000000001'),
    ('80000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','70000000-0000-0000-0000-000000000002');
  INSERT INTO public.ai_action_log(id,user_id,conversation_id) VALUES
    ('31000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','30000000-0000-0000-0000-000000000002');
  INSERT INTO public.development_tasks(id,user_id,conversation_id) VALUES
    ('32000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','30000000-0000-0000-0000-000000000002');
  INSERT INTO public.sport_program_items(id,program_id,exercise_id) VALUES
    ('41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
  INSERT INTO public.sport_workout_exercises(id,session_id,exercise_id) VALUES
    ('61000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001'),
    ('61000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002');
  INSERT INTO public.sport_workout_sets(id,workout_exercise_id) VALUES
    ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001'),
    ('62000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000002');
  INSERT INTO public.sport_progression_targets(id,user_id,exercise_id,based_on_session_id) VALUES
    ('63000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001'),
    ('63000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','50000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002');
  INSERT INTO public.health_e2ee_key_versions(id,user_id,current_key_version) VALUES
    ('71000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',1),
    ('71000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',1);
  INSERT INTO public.billing_customers(id,user_id) VALUES
    ('90000000-0000-0000-0000-000000000010','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('90000000-0000-0000-0000-000000000011','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.billing_subscriptions(id,user_id) VALUES
    ('90000000-0000-0000-0000-000000000020','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('90000000-0000-0000-0000-000000000021','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.billing_trials(id,user_id) VALUES
    ('90000000-0000-0000-0000-000000000030','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('90000000-0000-0000-0000-000000000031','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.notification_log(id,user_id) VALUES
    ('91000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('91000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.reminder_debug_log(id,user_id) VALUES
    ('92000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('92000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.health_legacy_migration_map(legacy_sample_id,user_id) VALUES
    ('20000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('20000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.ai_provider_secrets(id,user_id) VALUES
    ('93000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  INSERT INTO public.ai_tool_idempotency(id,user_id,conversation_id) VALUES
    ('94000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','30000000-0000-0000-0000-000000000001');
  INSERT INTO public.audit_log(id) VALUES ('95000000-0000-0000-0000-000000000001');
  INSERT INTO public.billing_events(id) VALUES ('96000000-0000-0000-0000-000000000001');
END;
$fixture_seed$;

DO $rls_enabled$
DECLARE missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
  IF missing_count <> 0 THEN RAISE EXCEPTION 'RLS missing on % public tables', missing_count; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='fixture_stale_profiles_select') THEN
    RAISE EXCEPTION 'stale permissive policy survived cleanup';
  END IF;
END;
$rls_enabled$;

BEGIN;
SET LOCAL ROLE anon;
DO $anon$
BEGIN
  PERFORM count(*) FROM public.nutrition_reference_foods;
  BEGIN
    INSERT INTO public.nutrition_reference_foods(id) VALUES ('00000000-0000-0000-0000-000000000099');
    RAISE EXCEPTION 'anon unexpectedly wrote to catalogue';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);

DO $user_a$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.profiles;
  IF n <> 1 THEN RAISE EXCEPTION 'profile isolation failed: expected 1 row, got %', n; END IF;
  SELECT count(*) INTO n FROM public.health_samples;
  IF n <> 1 THEN RAISE EXCEPTION 'legacy health SELECT isolation failed: expected 1 row, got %', n; END IF;

  BEGIN
    INSERT INTO public.profiles(id,user_id)
      VALUES ('10000000-0000-0000-0000-000000000003','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    RAISE EXCEPTION 'cross-user profile insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.health_samples(id,user_id)
      VALUES ('20000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'legacy plaintext health write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.ai_messages(id,user_id,conversation_id)
    VALUES ('30000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','30000000-0000-0000-0000-000000000001');

  BEGIN
    INSERT INTO public.development_tasks(id,user_id,conversation_id)
      VALUES ('32000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','30000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'cross-user development task insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.ai_action_log(id,user_id,conversation_id)
      VALUES ('31000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','30000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'cross-user AI action log insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.sport_program_items(id,program_id,exercise_id)
    VALUES ('41000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
  BEGIN
    INSERT INTO public.sport_program_items(id,program_id,exercise_id)
      VALUES ('41000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'cross-user program item insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.sport_workout_exercises(id,session_id,exercise_id)
    VALUES ('61000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
  BEGIN
    INSERT INTO public.sport_workout_exercises(id,session_id,exercise_id)
      VALUES ('61000000-0000-0000-0000-000000000004','60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'cross-user workout exercise insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.sport_workout_sets(id,workout_exercise_id)
    VALUES ('62000000-0000-0000-0000-000000000003','61000000-0000-0000-0000-000000000003');
  BEGIN
    INSERT INTO public.sport_workout_sets(id,workout_exercise_id)
      VALUES ('62000000-0000-0000-0000-000000000004','61000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'cross-user workout set insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.sport_progression_targets(id,user_id,exercise_id,based_on_session_id)
    VALUES ('63000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001');
  BEGIN
    INSERT INTO public.sport_progression_targets(id,user_id,exercise_id,based_on_session_id)
      VALUES ('63000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','50000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'cross-user progression target insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO n FROM public.billing_customers;
  IF n <> 1 THEN RAISE EXCEPTION 'billing customer owner read isolation failed: %',n; END IF;
  SELECT count(*) INTO n FROM public.billing_subscriptions;
  IF n <> 1 THEN RAISE EXCEPTION 'billing subscription owner read isolation failed: %',n; END IF;
  SELECT count(*) INTO n FROM public.billing_trials;
  IF n <> 1 THEN RAISE EXCEPTION 'billing trial owner read isolation failed: %',n; END IF;
  BEGIN
    UPDATE public.billing_customers SET user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      WHERE id='90000000-0000-0000-0000-000000000010';
    RAISE EXCEPTION 'billing customer UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO n FROM public.notification_log;
  IF n <> 1 THEN RAISE EXCEPTION 'notification log read isolation failed: %',n; END IF;
  SELECT count(*) INTO n FROM public.reminder_debug_log;
  IF n <> 1 THEN RAISE EXCEPTION 'reminder log read isolation failed: %',n; END IF;
  BEGIN
    INSERT INTO public.notification_log(id,user_id)
      VALUES ('91000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'notification log client INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.reminder_debug_log(id,user_id)
      VALUES ('92000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'reminder log client INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO n FROM public.health_e2ee_key_versions;
  IF n <> 1 THEN RAISE EXCEPTION 'E2EE key version owner read isolation failed: %',n; END IF;
  BEGIN
    INSERT INTO public.health_e2ee_key_versions(id,user_id,current_key_version)
      VALUES ('71000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',2);
    RAISE EXCEPTION 'direct key version INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.health_e2ee_key_envelopes(id,user_id,device_id,pairing_session_id)
      VALUES ('72000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','70000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'cross-user pairing envelope INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DO $envelope_diagnostics$
  DECLARE
    consent_ok boolean;
    device_ok boolean;
    pairing_ok boolean;
    uid_ok boolean;
    policy_snapshot text;
  BEGIN
    consent_ok := public.has_current_health_e2ee_consent();
    device_ok := EXISTS (
      SELECT 1 FROM public.health_e2ee_devices d
      WHERE d.id='70000000-0000-0000-0000-000000000001'
        AND d.user_id=(SELECT auth.uid())
    );
    pairing_ok := public.owns_health_e2ee_pairing_session('80000000-0000-0000-0000-000000000001');
    uid_ok := (SELECT auth.uid())='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    SELECT string_agg(policyname || ':' || cmd || ':check=' || coalesce(with_check,'<null>'), ' | ')
      INTO policy_snapshot
      FROM pg_policies
      WHERE schemaname='public' AND tablename='health_e2ee_key_envelopes';
    RAISE NOTICE 'envelope diagnostics consent=% device=% pairing=% uid=% policies=%',
      consent_ok,device_ok,pairing_ok,uid_ok,policy_snapshot;
    IF NOT consent_ok OR NOT device_ok OR NOT pairing_ok OR NOT uid_ok THEN
      RAISE EXCEPTION 'envelope predicate false: consent=% device=% pairing=% uid=%',
        consent_ok,device_ok,pairing_ok,uid_ok;
    END IF;
  END;
  $envelope_diagnostics$;

  INSERT INTO public.health_e2ee_key_envelopes(id,user_id,device_id,pairing_session_id)
    VALUES ('72000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','70000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001');

  BEGIN
    PERFORM legacy_sample_id FROM public.health_legacy_migration_map;
    RAISE EXCEPTION 'direct legacy migration map SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.ai_messages(id,user_id,conversation_id)
      VALUES ('30000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','30000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'cross-user conversation child insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.sport_workout_sessions(id,user_id,program_id)
      VALUES ('60000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','40000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'cross-user workout program insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.data_deletion_requests(id,user_id,status)
    VALUES ('90000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pending');

  BEGIN
    INSERT INTO public.data_deletion_requests(id,user_id,status,completed_at)
      VALUES ('90000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','completed',now());
    RAISE EXCEPTION 'client submitted a completed deletion request';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO n FROM public.health_samples_e2ee;
  IF n <> 0 THEN RAISE EXCEPTION 'E2EE samples visible without consent'; END IF;
  BEGIN
    INSERT INTO public.health_samples_e2ee(id,user_id)
      VALUES ('a0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'E2EE write succeeded without required consent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.consent_records(id,user_id,consent_type,granted,created_at) VALUES
    ('b0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','health_data',true,now()),
    ('b0000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','health_cloud_sync',true,now());

  INSERT INTO public.health_samples_e2ee(id,user_id)
    VALUES ('a0000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  SELECT count(*) INTO n FROM public.health_samples_e2ee;
  IF n <> 1 THEN RAISE EXCEPTION 'consented E2EE sample write/read failed'; END IF;

  BEGIN
    UPDATE public.consent_records SET granted=false WHERE id='b0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'consent UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF NOT public.owns_health_e2ee_pairing_session('80000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'pairing ownership helper rejected the owner';
  END IF;
  IF public.owns_health_e2ee_pairing_session('80000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'pairing ownership helper accepted another user';
  END IF;

  BEGIN
    PERFORM id FROM public.health_e2ee_pairing_sessions;
    RAISE EXCEPTION 'direct pairing session SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM id FROM public.ai_provider_secrets;
    RAISE EXCEPTION 'direct provider secret SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM id FROM public.ai_tool_idempotency;
    RAISE EXCEPTION 'direct idempotency SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$user_a$;
ROLLBACK;

SELECT 'RLS PostgreSQL integration assertions passed' AS result;
