-- Keep sensitive application tables inaccessible to the anon role.
-- RLS policies remain the ownership boundary for authenticated users.
revoke all on table public.user_state, public.profiles, public.food_log, public.food_scans, public.health_samples, public.legal_consent from anon;

revoke execute on function public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text) from anon;
revoke execute on function public.upsert_profile_if_newer(uuid,jsonb,timestamptz,text) from anon;

grant execute on function public.upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.upsert_profile_if_newer(uuid,jsonb,timestamptz,text) to authenticated;
