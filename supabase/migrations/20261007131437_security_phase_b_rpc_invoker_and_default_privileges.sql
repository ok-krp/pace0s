begin;

drop policy if exists health_e2ee_pairing_sessions_deny_client on public.health_e2ee_pairing_sessions;

drop policy if exists health_e2ee_pairing_sessions_select_own on public.health_e2ee_pairing_sessions;
create policy health_e2ee_pairing_sessions_select_own on public.health_e2ee_pairing_sessions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists health_e2ee_pairing_sessions_insert_own on public.health_e2ee_pairing_sessions;
create policy health_e2ee_pairing_sessions_insert_own on public.health_e2ee_pairing_sessions
  for insert to authenticated
  with check ((select auth.uid()) = user_id and has_current_health_e2ee_consent());

drop policy if exists health_e2ee_pairing_sessions_update_own on public.health_e2ee_pairing_sessions;
create policy health_e2ee_pairing_sessions_update_own on public.health_e2ee_pairing_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id and has_current_health_e2ee_consent())
  with check ((select auth.uid()) = user_id and has_current_health_e2ee_consent());

grant select, insert, update on table public.health_e2ee_pairing_sessions to authenticated;

alter function public.create_pairing_session(uuid, text, text, jsonb, integer) security invoker;
alter function public.join_pairing_session(uuid, text, uuid, jsonb) security invoker;
alter function public.confirm_pairing_session(uuid, uuid) security invoker;
alter function public.complete_pairing_session(uuid, uuid) security invoker;
alter function public.create_pairing_envelope(uuid, uuid, uuid, text, integer, text) security invoker;
alter function public.get_pairing_session(uuid) security invoker;
alter function public.upsert_user_state_if_newer(uuid, text, jsonb, timestamptz, text) security invoker;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public;

commit;