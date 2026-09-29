revoke execute on function public.backfill_health_e2ee_dedupe_hashes(jsonb) from anon;
revoke execute on function public.create_pairing_session(uuid,text,text,jsonb,integer) from anon;
revoke execute on function public.join_pairing_session(uuid,text,uuid,jsonb) from anon;
revoke execute on function public.get_pairing_session(uuid) from anon;
revoke execute on function public.confirm_pairing_session(uuid,uuid) from anon;
revoke execute on function public.create_pairing_envelope(uuid,uuid,uuid,text,integer,text) from anon;
revoke execute on function public.complete_pairing_session(uuid,uuid) from anon;
