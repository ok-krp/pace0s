create table if not exists public.health_e2ee_key_versions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_key_version integer not null default 1 check (current_key_version > 0),
  updated_at timestamptz not null default now()
);
alter table public.health_e2ee_key_versions enable row level security;
revoke all on public.health_e2ee_key_versions from anon;
grant select on public.health_e2ee_key_versions to authenticated;
drop policy if exists health_e2ee_key_versions_select_own on public.health_e2ee_key_versions;
create policy health_e2ee_key_versions_select_own on public.health_e2ee_key_versions
for select to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.health_e2ee_recovery_envelopes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  envelope text not null,
  nonce text not null,
  algorithm text not null default 'PBKDF2-SHA-256/AES-256-GCM',
  key_version integer not null check (key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_e2ee_recovery_algorithm_check check (algorithm = 'PBKDF2-SHA-256/AES-256-GCM')
);
alter table public.health_e2ee_recovery_envelopes enable row level security;
revoke all on public.health_e2ee_recovery_envelopes from anon;
grant select, insert, update, delete on public.health_e2ee_recovery_envelopes to authenticated;
drop policy if exists health_e2ee_recovery_select_own on public.health_e2ee_recovery_envelopes;
create policy health_e2ee_recovery_select_own on public.health_e2ee_recovery_envelopes
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists health_e2ee_recovery_insert_own on public.health_e2ee_recovery_envelopes;
create policy health_e2ee_recovery_insert_own on public.health_e2ee_recovery_envelopes
for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists health_e2ee_recovery_update_own on public.health_e2ee_recovery_envelopes;
create policy health_e2ee_recovery_update_own on public.health_e2ee_recovery_envelopes
for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists health_e2ee_recovery_delete_own on public.health_e2ee_recovery_envelopes;
create policy health_e2ee_recovery_delete_own on public.health_e2ee_recovery_envelopes
for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.rotate_health_e2ee_key(
  p_new_key_version integer,
  p_revoked_device_id uuid default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_new_key_version <= 1 then raise exception 'Invalid key version'; end if;
  if p_revoked_device_id is not null then
    update public.health_e2ee_devices
      set revoked_at = coalesce(revoked_at, now())
      where id = p_revoked_device_id and user_id = auth.uid();
  end if;
  insert into public.health_e2ee_key_versions(user_id, current_key_version)
    values (auth.uid(), p_new_key_version)
    on conflict (user_id) do update
      set current_key_version = excluded.current_key_version, updated_at = now();
end;
$$;

insert into public.health_e2ee_key_versions(user_id,current_key_version)
select distinct user_id, greatest(1,max(key_version))
from public.health_samples_e2ee
group by user_id
on conflict (user_id) do nothing;
