-- Integration assertions. Migration is applied before this file.
\set ON_ERROR_STOP on

-- A function created after the migration must not inherit PUBLIC or API-role
-- EXECUTE. The two RLS helpers retain only their explicit authenticated grant.
create function public.rls_default_execute_probe()
returns boolean
language sql
as $rls_default_probe$
  select true;
$rls_default_probe$;

DO $function_privileges$
BEGIN
  IF has_function_privilege('anon', 'public.rls_default_execute_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'new public function inherited EXECUTE for anon';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'public.rls_default_execute_probe()'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'new public function inherited explicit PUBLIC EXECUTE';
  END IF;
  IF has_function_privilege('authenticated', 'public.rls_default_execute_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'new public function inherited EXECUTE for authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.has_current_health_e2ee_consent()', 'EXECUTE') THEN
    RAISE EXCEPTION 'health consent helper is executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.has_current_health_e2ee_consent()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute the app health consent RPC';
  END IF;
  IF has_function_privilege('anon', 'pace_private.owns_health_e2ee_pairing_session(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'pairing ownership helper is executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'pace_private.owns_health_e2ee_pairing_session(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot call the pairing ownership helper from RLS';
  END IF;
  IF has_schema_privilege('anon','public','CREATE')
     OR has_schema_privilege('authenticated','public','CREATE') THEN
    RAISE EXCEPTION 'API roles can CREATE objects in exposed public schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = ANY (ARRAY[
      'public.sync_sport_user_state()'::regprocedure,
      'public.delete_temporary_workout_after_finish()'::regprocedure,
      'public.touch_ai_provider_secret_updated_at()'::regprocedure,
      'public.prevent_audit_log_mutation()'::regprocedure,
      'public.prevent_consent_mutation()'::regprocedure,
      'public.set_deletion_request_updated_at()'::regprocedure,
      'public.delete_user_data(uuid)'::regprocedure,
      'public.sync_sport_program_archive_state()'::regprocedure,
      'public.enforce_daily_nutrition_chat()'::regprocedure
    ])
    AND (p.proconfig IS NULL OR NOT p.proconfig @> ARRAY['search_path=""'])
  ) THEN
    RAISE EXCEPTION 'an existing SECURITY DEFINER routine does not have an empty search_path';
  END IF;

  IF has_function_privilege('anon','public.sync_sport_user_state()','EXECUTE')
     OR has_function_privilege('authenticated','public.sync_sport_user_state()','EXECUTE')
     OR has_function_privilege('anon','public.delete_temporary_workout_after_finish()','EXECUTE')
     OR has_function_privilege('authenticated','public.delete_temporary_workout_after_finish()','EXECUTE')
     OR has_function_privilege('anon','public.touch_ai_provider_secret_updated_at()','EXECUTE')
     OR has_function_privilege('authenticated','public.touch_ai_provider_secret_updated_at()','EXECUTE')
     OR has_function_privilege('anon','public.prevent_audit_log_mutation()','EXECUTE')
     OR has_function_privilege('authenticated','public.prevent_audit_log_mutation()','EXECUTE')
     OR has_function_privilege('anon','public.prevent_consent_mutation()','EXECUTE')
     OR has_function_privilege('authenticated','public.prevent_consent_mutation()','EXECUTE')
     OR has_function_privilege('anon','public.set_deletion_request_updated_at()','EXECUTE')
     OR has_function_privilege('authenticated','public.set_deletion_request_updated_at()','EXECUTE')
     OR has_function_privilege('anon','public.delete_user_data(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.delete_user_data(uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.delete_user_data(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'a trigger-only or dormant SECURITY DEFINER routine has unexpected API/service EXECUTE';
  END IF;

  IF has_function_privilege('anon','public.rotate_health_e2ee_key(integer,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.rotate_health_e2ee_key(integer,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated RPC caller grants are not least-privilege';
  END IF;
END;
$function_privileges$;
DROP FUNCTION public.rls_default_execute_probe();

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
  INSERT INTO public.sport_workout_sessions (id,user_id,program_id,is_temporary) VALUES
    ('60000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','40000000-0000-0000-0000-000000000001',true),
    ('60000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','40000000-0000-0000-0000-000000000002',true);
  INSERT INTO public.user_state(id,user_id,key,value,updated_by) VALUES
    ('65000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','fixture','{}'::jsonb,'fixture'),
    ('65000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','fixture','{}'::jsonb,'fixture');
  INSERT INTO public.health_e2ee_devices (id,user_id,revoked_at) VALUES
    ('70000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',NULL),
    ('70000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',NULL),
    ('70000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',now());
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
  INSERT INTO public.consent_records(user_id,consent_type,granted,legal_version,policy_version) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','health_data',true,'2026-07-10','2026-07-10'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','health_cloud_sync',true,'2026-07-10','2026-07-10');
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

  BEGIN
    PERFORM id FROM public.profiles;
    RAISE EXCEPTION 'anon unexpectedly read private profiles';
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
  IF has_table_privilege('authenticated','public.health_e2ee_devices','UPDATE') THEN
    RAISE EXCEPTION 'authenticated can directly UPDATE device revocation state';
  END IF;
  IF has_column_privilege('authenticated','public.health_e2ee_devices','id','INSERT')
     OR has_column_privilege('authenticated','public.health_e2ee_devices','created_at','INSERT')
     OR has_column_privilege('authenticated','public.health_e2ee_devices','revoked_at','INSERT') THEN
    RAISE EXCEPTION 'authenticated can choose E2EE device ID, timestamp or revocation state';
  END IF;
  IF has_table_privilege('authenticated','public.user_state','INSERT')
     OR has_table_privilege('authenticated','public.user_state','UPDATE')
     OR has_table_privilege('authenticated','public.user_state','DELETE') THEN
    RAISE EXCEPTION 'authenticated can bypass monotonic user_state RPC with direct writes';
  END IF;
  IF has_table_privilege('authenticated','public.health_e2ee_recovery_envelopes','DELETE') THEN
    RAISE EXCEPTION 'authenticated can directly delete an E2EE recovery envelope';
  END IF;
  IF has_column_privilege('authenticated','public.health_e2ee_key_envelopes','id','INSERT')
     OR has_column_privilege('authenticated','public.health_e2ee_key_envelopes','created_at','INSERT') THEN
    RAISE EXCEPTION 'authenticated can choose E2EE envelope ID or timestamp';
  END IF;
  IF has_table_privilege('authenticated','public.health_e2ee_key_envelopes','DELETE') THEN
    RAISE EXCEPTION 'authenticated can directly delete E2EE key envelopes';
  END IF;
  IF has_column_privilege('authenticated','public.consent_records','id','INSERT') THEN
    RAISE EXCEPTION 'authenticated can choose consent record identifiers';
  END IF;
  IF has_column_privilege('authenticated','public.consent_records','created_at','INSERT') THEN
    RAISE EXCEPTION 'authenticated can choose consent record timestamps';
  END IF;
  IF NOT has_column_privilege('authenticated','public.consent_records','consent_type','INSERT')
     OR NOT has_column_privilege('authenticated','public.consent_records','granted','INSERT')
     OR NOT has_column_privilege('authenticated','public.consent_records','legal_version','INSERT')
     OR NOT has_column_privilege('authenticated','public.consent_records','policy_version','INSERT') THEN
    RAISE EXCEPTION 'authenticated is missing required consent decision columns';
  END IF;

  BEGIN
    INSERT INTO public.consent_records(id,user_id,consent_type,granted,legal_version,policy_version,created_at)
      VALUES ('b1000000-0000-0000-0000-000000000099','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              'health_data',true,'2026-07-10','2026-07-10',now() + interval '1 day');
    RAISE EXCEPTION 'client overrode consent record id/timestamp';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO n FROM public.user_state;
  IF n <> 1 THEN RAISE EXCEPTION 'user_state owner SELECT isolation failed: expected 1 row, got %',n; END IF;
  SELECT count(*) INTO n FROM public.user_state
    WHERE user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  IF n <> 0 THEN RAISE EXCEPTION 'user A can read user B user_state'; END IF;
  BEGIN
    INSERT INTO public.user_state(user_id,key,value)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','rpc-bypass-insert','{}'::jsonb);
    RAISE EXCEPTION 'direct user_state INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.user_state SET value='{}'::jsonb WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    RAISE EXCEPTION 'direct user_state UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.user_state WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    RAISE EXCEPTION 'direct user_state DELETE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- The role has no direct EXECUTE on the trigger function, but can update
  -- its own session and PostgreSQL still invokes the already-bound trigger.
  UPDATE public.sport_workout_sessions
  SET ended_at=now()
  WHERE id='60000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'owner workout UPDATE did not execute its protected trigger'; END IF;

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
    UPDATE public.profiles
    SET user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    WHERE id='10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'profile owner reassignment unexpectedly succeeded';
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

  INSERT INTO public.data_deletion_requests(user_id)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  SELECT count(*) INTO n FROM public.data_deletion_requests
    WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND status='pending' AND completed_at IS NULL AND error_code IS NULL
      AND id IS NOT NULL AND requested_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'owner could not submit a database-default pending deletion request'; END IF;

  BEGIN
    INSERT INTO public.data_deletion_requests(id,user_id,status,completed_at)
      VALUES ('90000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','completed',now());
    RAISE EXCEPTION 'client submitted a completed deletion request';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.health_e2ee_devices(user_id,device_name,public_key,algorithm)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','without-consent','{}'::jsonb,'ECDH-P256');
    RAISE EXCEPTION 'E2EE device registration succeeded without required consent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.health_e2ee_recovery_envelopes;
  IF n <> 0 THEN RAISE EXCEPTION 'E2EE recovery envelope visible without consent'; END IF;
  BEGIN
    INSERT INTO public.health_e2ee_recovery_envelopes(user_id,envelope,nonce,algorithm,key_version)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cipher','nonce','PBKDF2-SHA-256/AES-256-GCM',1);
    RAISE EXCEPTION 'E2EE recovery write succeeded without required consent';
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

  INSERT INTO public.consent_records(user_id,consent_type,granted,legal_version,policy_version) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','health_data',true,'2026-07-10','2026-07-10'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','health_cloud_sync',true,'2026-07-10','2026-07-10');

  SELECT count(*) INTO n FROM public.consent_records
  WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    AND consent_type IN ('health_data','health_cloud_sync')
    AND created_at=(SELECT now());
  IF n <> 2 THEN RAISE EXCEPTION 'database timestamp default not applied to consent records: %',n; END IF;

  INSERT INTO public.health_e2ee_devices(user_id,device_name,public_key,algorithm)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','consented-device','{}'::jsonb,'ECDH-P256');
  SELECT count(*) INTO n FROM public.health_e2ee_devices
    WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND device_name='consented-device' AND id IS NOT NULL AND created_at IS NOT NULL AND revoked_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'database-generated E2EE device registration failed'; END IF;

  INSERT INTO public.health_e2ee_recovery_envelopes(user_id,envelope,nonce,algorithm,key_version)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','wrapped-key','wrapped-nonce','PBKDF2-SHA-256/AES-256-GCM',1)
    ON CONFLICT (user_id) DO UPDATE SET envelope=EXCLUDED.envelope,nonce=EXCLUDED.nonce,
      algorithm=EXCLUDED.algorithm,key_version=EXCLUDED.key_version;
  SELECT count(*) INTO n FROM public.health_e2ee_recovery_envelopes;
  IF n <> 1 THEN RAISE EXCEPTION 'consented E2EE recovery envelope write failed'; END IF;

  BEGIN
    UPDATE public.health_e2ee_devices SET revoked_at=NULL
    WHERE id='70000000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'client directly reactivated revoked E2EE device';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.health_e2ee_key_envelopes(user_id,device_id,sender_device_id,pairing_session_id,envelope,nonce,algorithm,key_version)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','70000000-0000-0000-0000-000000000001',
              '70000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002',
              'cross-account-pairing','nonce','ECDH-P256/AES-256-GCM',1);
    RAISE EXCEPTION 'cross-user pairing envelope INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.health_e2ee_key_envelopes(user_id,device_id,sender_device_id,envelope,nonce,algorithm,key_version)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','70000000-0000-0000-0000-000000000003',
              '70000000-0000-0000-0000-000000000001','revoked-recipient','nonce','ECDH-P256/AES-256-GCM',1);
    RAISE EXCEPTION 'envelope for revoked recipient device unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.health_e2ee_key_envelopes(user_id,device_id,sender_device_id,envelope,nonce,algorithm,key_version)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','70000000-0000-0000-0000-000000000001',
              '70000000-0000-0000-0000-000000000003','revoked-sender','nonce','ECDH-P256/AES-256-GCM',1);
    RAISE EXCEPTION 'envelope from revoked sender device unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.health_samples_e2ee(id,user_id)
    VALUES ('a0000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  SELECT count(*) INTO n FROM public.health_samples_e2ee;
  IF n <> 1 THEN RAISE EXCEPTION 'consented E2EE sample write/read failed'; END IF;

  BEGIN
    UPDATE public.consent_records SET granted=false
    WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND consent_type='health_data';
    RAISE EXCEPTION 'consent UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF NOT pace_private.owns_health_e2ee_pairing_session('80000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'pairing ownership helper rejected the owner';
  END IF;
  IF pace_private.owns_health_e2ee_pairing_session('80000000-0000-0000-0000-000000000002') THEN
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

-- Use a fresh top-level SQL command after consent inserts. This mirrors the
-- separate PostgREST statement snapshot seen by the real application.
DO $post_user_a_e2ee_check$
DECLARE consent_ok boolean; device_ok boolean; pairing_ok boolean; uid_ok boolean;
BEGIN
  consent_ok := public.has_current_health_e2ee_consent();
  device_ok := EXISTS (
    SELECT 1 FROM public.health_e2ee_devices d
    WHERE d.id='70000000-0000-0000-0000-000000000001'
      AND d.user_id=(SELECT auth.uid())
  );
  pairing_ok := pace_private.owns_health_e2ee_pairing_session('80000000-0000-0000-0000-000000000001');
  uid_ok := (SELECT auth.uid())='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  RAISE NOTICE 'post-DО envelope predicates consent=% device=% pairing=% uid=%',
    consent_ok,device_ok,pairing_ok,uid_ok;
  IF NOT consent_ok OR NOT device_ok OR NOT pairing_ok OR NOT uid_ok THEN
    RAISE EXCEPTION 'post-DO envelope predicate false: consent=% device=% pairing=% uid=%',
      consent_ok,device_ok,pairing_ok,uid_ok;
  END IF;
END;
$post_user_a_e2ee_check$;

INSERT INTO public.health_e2ee_key_envelopes(user_id,device_id,sender_device_id,pairing_session_id,envelope,nonce,algorithm,key_version)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','70000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
          'valid-envelope','nonce','ECDH-P256/AES-256-GCM',1);
DO $envelope_defaults$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.health_e2ee_key_envelopes
  WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    AND id IS NOT NULL AND created_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'database-generated E2EE envelope ID/timestamp failed'; END IF;
END;
$envelope_defaults$;

INSERT INTO public.health_e2ee_key_envelopes(
  user_id,device_id,sender_device_id,pairing_session_id,envelope,nonce,algorithm,key_version
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '70000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000001',
  'key-wrap-envelope',NULL,'ECDH-P256/HKDF-SHA256/AES-256-KW',1
);
DO $envelope_nonce_contract$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.health_e2ee_key_envelopes
  WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    AND algorithm='ECDH-P256/HKDF-SHA256/AES-256-KW'
    AND nonce IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'AES Key Wrap envelope must accept NULL nonce'; END IF;
  SELECT count(*) INTO n FROM public.health_e2ee_key_envelopes
  WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    AND algorithm='ECDH-P256/AES-256-GCM'
    AND nonce IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'AES-GCM envelope must retain its nonce'; END IF;

  BEGIN
    INSERT INTO public.health_e2ee_key_envelopes(
      user_id,device_id,sender_device_id,pairing_session_id,envelope,nonce,algorithm,key_version
    ) VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '70000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      'invalid-gcm-no-nonce',NULL,'ECDH-P256/AES-256-GCM',1
    );
    RAISE EXCEPTION 'AES-GCM envelope without a nonce unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.health_e2ee_key_envelopes(
      user_id,device_id,sender_device_id,pairing_session_id,envelope,nonce,algorithm,key_version
    ) VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '70000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      'invalid-kw-with-nonce','must-not-exist','ECDH-P256/AES-256-KW',1
    );
    RAISE EXCEPTION 'AES Key Wrap envelope with a nonce unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$envelope_nonce_contract$;

-- Commit the initial granted decisions. The withdrawal is a separate request
-- transaction, so PostgreSQL's now() default is strictly later, as in PostgREST.
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);

-- Simulate the user revoking health-data consent in a later database transaction.
INSERT INTO public.consent_records(user_id,consent_type,granted,legal_version,policy_version)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','health_data',false,'2026-07-10','2026-07-10');

DO $health_consent_revoked$
DECLARE n integer;
BEGIN
  IF public.has_current_health_e2ee_consent() THEN
    RAISE EXCEPTION 'latest false health consent did not revoke E2EE access';
  END IF;

  SELECT count(*) INTO n FROM public.health_samples_e2ee;
  IF n <> 0 THEN RAISE EXCEPTION 'encrypted samples remain visible after consent revocation'; END IF;
  SELECT count(*) INTO n FROM public.health_e2ee_key_envelopes;
  IF n <> 0 THEN RAISE EXCEPTION 'key envelopes remain visible after consent revocation'; END IF;
  SELECT count(*) INTO n FROM public.health_e2ee_recovery_envelopes;
  IF n <> 0 THEN RAISE EXCEPTION 'recovery envelopes remain visible after consent revocation'; END IF;

  UPDATE public.health_e2ee_recovery_envelopes
  SET envelope='revoked-update-must-affect-zero-rows'
  WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'recovery envelope update succeeded after consent revocation'; END IF;

  BEGIN
    INSERT INTO public.health_e2ee_recovery_envelopes(user_id,envelope,nonce,algorithm,key_version)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','after-revoke','nonce','PBKDF2-SHA-256/AES-256-GCM',2);
    RAISE EXCEPTION 'recovery envelope insert succeeded after consent revocation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.health_samples_e2ee(id,user_id)
      VALUES ('a0000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'E2EE sample insert succeeded after consent revocation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.health_e2ee_key_envelopes(user_id,device_id,sender_device_id,pairing_session_id,envelope,nonce,algorithm,key_version)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','70000000-0000-0000-0000-000000000001',
              '70000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
              'after-revoke','nonce','ECDH-P256/AES-256-GCM',1);
    RAISE EXCEPTION 'E2EE envelope insert succeeded after consent revocation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$health_consent_revoked$;


ROLLBACK;

-- A second authenticated session must see only B's rows too. This is a
-- separate transaction/GUC context, not a second assertion under user A.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
DO $user_b$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.profiles;
  IF n <> 1 THEN RAISE EXCEPTION 'user B profile isolation failed: expected 1 row, got %',n; END IF;

  SELECT count(*) INTO n FROM public.profiles
  WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF n <> 0 THEN RAISE EXCEPTION 'user B can read user A profile'; END IF;
  SELECT count(*) INTO n FROM public.user_state
  WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF n <> 0 THEN RAISE EXCEPTION 'user B can read user A user_state'; END IF;
  SELECT count(*) INTO n FROM public.health_e2ee_recovery_envelopes;
  IF n <> 0 THEN RAISE EXCEPTION 'user B can read user A E2EE recovery envelope'; END IF;

  BEGIN
    UPDATE public.profiles
    SET user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    WHERE id='10000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'user B profile owner reassignment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$user_b$;
ROLLBACK;

SELECT 'RLS PostgreSQL integration assertions passed' AS result;
