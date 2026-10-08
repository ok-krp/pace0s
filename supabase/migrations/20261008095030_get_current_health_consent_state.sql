-- Return only the latest state for the two health consent switches.
-- This avoids transferring the full append-only consent history to UI callers.
create or replace function public.get_current_health_consent_state()
returns table (health_data boolean, health_cloud_sync boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce((
      select c.granted
      from public.consent_records as c
      where c.user_id = (select auth.uid())
        and c.consent_type = 'health_data'
      order by c.created_at desc, c.id desc
      limit 1
    ), false) as health_data,
    coalesce((
      select c.granted
      from public.consent_records as c
      where c.user_id = (select auth.uid())
        and c.consent_type = 'health_cloud_sync'
      order by c.created_at desc, c.id desc
      limit 1
    ), false) as health_cloud_sync;
$$;

revoke all on function public.get_current_health_consent_state() from public;
revoke execute on function public.get_current_health_consent_state() from anon;
grant execute on function public.get_current_health_consent_state() to authenticated;
