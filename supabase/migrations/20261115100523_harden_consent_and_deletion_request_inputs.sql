-- Trust the database clock for immutable consent history and constrain
-- client-created account-deletion requests to the pending state.

create or replace function public.set_consent_record_server_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_consent_record_server_timestamp() from public, anon, authenticated;

drop trigger if exists consent_records_server_timestamp on public.consent_records;
create trigger consent_records_server_timestamp
before insert on public.consent_records
for each row execute function public.set_consent_record_server_timestamp();

create or replace function public.has_current_health_e2ee_consent()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    coalesce((
      select c.granted
      from public.consent_records c
      where c.user_id = (select auth.uid())
        and c.consent_type = 'health_data'
      order by c.created_at desc, c.id desc
      limit 1
    ), false)
    and coalesce((
      select c.granted
      from public.consent_records c
      where c.user_id = (select auth.uid())
        and c.consent_type = 'health_cloud_sync'
      order by c.created_at desc, c.id desc
      limit 1
    ), false);
$$;

revoke all on function public.has_current_health_e2ee_consent() from public, anon;
grant execute on function public.has_current_health_e2ee_consent() to authenticated, service_role;

-- Authenticated clients may create a consent event but cannot set its UUID or
-- timestamp, rewrite history, or delete past consent records.
revoke insert, update, delete on public.consent_records from public, anon, authenticated;
grant insert (user_id, consent_type, granted, legal_version, policy_version)
  on public.consent_records to authenticated;

-- A client may request deletion, but cannot forge processing/completion states
-- or edit/delete the server-owned audit record.
drop policy if exists deletion_requests_insert_own on public.data_deletion_requests;
create policy deletion_requests_insert_own
on public.data_deletion_requests
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and completed_at is null
  and error_code is null
);

revoke insert, update, delete on public.data_deletion_requests from public, anon, authenticated;
grant insert (user_id, status) on public.data_deletion_requests to authenticated;
