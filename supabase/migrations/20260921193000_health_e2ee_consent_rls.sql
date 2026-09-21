create or replace function public.has_current_health_e2ee_consent()
returns boolean language sql stable security invoker set search_path = public
as $$
  select
    exists (
      select 1 from public.consent_records c
      where c.user_id = (select auth.uid())
        and c.consent_type = 'health_data'
        and c.granted = true
        and c.created_at = (select max(c2.created_at) from public.consent_records c2 where c2.user_id = (select auth.uid()) and c2.consent_type = 'health_data')
    )
    and exists (
      select 1 from public.consent_records c
      where c.user_id = (select auth.uid())
        and c.consent_type = 'health_cloud_sync'
        and c.granted = true
        and c.created_at = (select max(c2.created_at) from public.consent_records c2 where c2.user_id = (select auth.uid()) and c2.consent_type = 'health_cloud_sync')
    );
$$;
revoke all on function public.has_current_health_e2ee_consent() from public;
grant execute on function public.has_current_health_e2ee_consent() to authenticated;

drop policy if exists health_samples_e2ee_select_own on public.health_samples_e2ee;
create policy health_samples_e2ee_select_own on public.health_samples_e2ee for select to authenticated using ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent());
drop policy if exists health_samples_e2ee_insert_own on public.health_samples_e2ee;
create policy health_samples_e2ee_insert_own on public.health_samples_e2ee for insert to authenticated with check ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent());

drop policy if exists health_e2ee_devices_select_own on public.health_e2ee_devices;
create policy health_e2ee_devices_select_own on public.health_e2ee_devices for select to authenticated using ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent());
drop policy if exists health_e2ee_devices_insert_own on public.health_e2ee_devices;
create policy health_e2ee_devices_insert_own on public.health_e2ee_devices for insert to authenticated with check ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent());
drop policy if exists health_e2ee_devices_update_own on public.health_e2ee_devices;
create policy health_e2ee_devices_update_own on public.health_e2ee_devices for update to authenticated using ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent()) with check ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent());

drop policy if exists health_e2ee_envelopes_select_own on public.health_e2ee_key_envelopes;
create policy health_e2ee_envelopes_select_own on public.health_e2ee_key_envelopes for select to authenticated using ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent());
drop policy if exists health_e2ee_envelopes_insert_own on public.health_e2ee_key_envelopes;
create policy health_e2ee_envelopes_insert_own on public.health_e2ee_key_envelopes for insert to authenticated with check ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent());
drop policy if exists health_e2ee_envelopes_delete_own on public.health_e2ee_key_envelopes;
create policy health_e2ee_envelopes_delete_own on public.health_e2ee_key_envelopes for delete to authenticated using ((select auth.uid()) = user_id and public.has_current_health_e2ee_consent());
