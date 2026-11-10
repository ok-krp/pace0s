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
