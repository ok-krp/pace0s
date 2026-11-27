-- Preserve collaborative workspace data during account deletion.
-- Shared content keeps its rows; deleted authors become NULL. Empty owned workspaces
-- are removed by prepare_account_deletion(), while populated ones are transferred.

alter table public.grocery_lists
  alter column created_by drop not null;
alter table public.grocery_lists
  drop constraint grocery_lists_created_by_fkey;
alter table public.grocery_lists
  add constraint grocery_lists_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.grocery_list_items
  alter column created_by drop not null;
alter table public.grocery_list_items
  drop constraint grocery_list_items_created_by_fkey;
alter table public.grocery_list_items
  add constraint grocery_list_items_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.pantry_items
  alter column created_by drop not null;
alter table public.pantry_items
  drop constraint pantry_items_created_by_fkey;
alter table public.pantry_items
  add constraint pantry_items_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- Prevent an accidental Auth deletion from cascading away a shared workspace.
alter table public.workspaces
  drop constraint workspaces_owner_user_id_fkey;
alter table public.workspaces
  add constraint workspaces_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete restrict;

-- Keep a minimal, anonymised deletion-request record after the Auth user is removed.
alter table public.data_deletion_requests
  alter column user_id drop not null;
alter table public.data_deletion_requests
  drop constraint data_deletion_requests_user_id_fkey;
alter table public.data_deletion_requests
  add constraint data_deletion_requests_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create or replace function public.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_successor uuid;
  v_transferred integer := 0;
  v_deleted integer := 0;
begin
  if p_user_id is null then
    raise exception 'account deletion user id is required';
  end if;

  for v_workspace_id in
    select w.id
    from public.workspaces w
    where w.owner_user_id = p_user_id
    order by w.id
    for update
  loop
    v_successor := null;

    select wm.user_id
      into v_successor
    from public.workspace_members wm
    where wm.workspace_id = v_workspace_id
      and wm.user_id <> p_user_id
    order by
      case wm.role when 'admin' then 0 when 'member' then 1 else 2 end,
      wm.created_at,
      wm.user_id
    limit 1
    for update;

    if v_successor is null then
      -- No surviving member: this is an orphaned/private workspace.
      -- Cascading child deletes are confined to this workspace.
      delete from public.workspaces where id = v_workspace_id;
      v_deleted := v_deleted + 1;
    else
      -- Transfer ownership before deleting the former owner.
      update public.workspaces
      set owner_user_id = v_successor,
          updated_at = now()
      where id = v_workspace_id;

      insert into public.workspace_members (workspace_id, user_id, role)
      values (v_workspace_id, v_successor, 'owner')
      on conflict (workspace_id, user_id)
      do update set role = 'owner';

      v_transferred := v_transferred + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'transferred_workspaces', v_transferred,
    'deleted_private_workspaces', v_deleted
  );
end;
$$;

revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
