-- Serialize account deletion claims per user and reuse pending requests.
-- The partial unique index prevents duplicate active rows, but the previous
-- application-level insert did not claim an existing pending request.
create or replace function public.claim_account_deletion_request(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_status text;
begin
  if p_user_id is null then
    raise exception 'User ID required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select request.id, request.status
    into v_request_id, v_status
    from public.data_deletion_requests request
    where request.user_id = p_user_id
      and request.status in ('pending', 'processing')
    order by request.created_at desc, request.id desc
    limit 1
    for update;

  if found then
    if v_status = 'processing' then
      raise exception 'Account deletion is already processing';
    end if;

    update public.data_deletion_requests
      set status = 'processing', error_code = null
      where id = v_request_id and user_id = p_user_id and status = 'pending'
      returning id into v_request_id;

    if v_request_id is null then
      raise exception 'Account deletion request claim lost a race';
    end if;
    return v_request_id;
  end if;

  insert into public.data_deletion_requests (user_id, status)
    values (p_user_id, 'processing')
    returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.claim_account_deletion_request(uuid) from public, anon, authenticated;
grant execute on function public.claim_account_deletion_request(uuid) to service_role;
