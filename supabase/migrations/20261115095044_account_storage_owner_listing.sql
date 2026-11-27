-- Read only the storage objects owned by a user so the trusted server can
-- remove them through the Storage API before deleting the Auth account.
create or replace function public.list_account_storage_objects(p_user_id uuid)
returns table(bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where p_user_id is not null
    and o.bucket_id is not null
    and o.name is not null
    and (o.owner_id = p_user_id::text or o.owner = p_user_id)
  order by o.bucket_id, o.name;
$$;

revoke all on function public.list_account_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.list_account_storage_objects(uuid) to service_role;
