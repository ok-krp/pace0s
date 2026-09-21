create table if not exists public.health_e2ee_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null default 'Pace device',
  public_key jsonb not null,
  algorithm text not null default 'ECDH-P256',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists health_e2ee_devices_user_idx on public.health_e2ee_devices (user_id, created_at desc);
alter table public.health_e2ee_devices enable row level security;
revoke all on public.health_e2ee_devices from anon;
grant select, insert, update on public.health_e2ee_devices to authenticated;
create policy health_e2ee_devices_select_own on public.health_e2ee_devices for select to authenticated using ((select auth.uid()) = user_id);
create policy health_e2ee_devices_insert_own on public.health_e2ee_devices for insert to authenticated with check ((select auth.uid()) = user_id);
create policy health_e2ee_devices_update_own on public.health_e2ee_devices for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.health_e2ee_key_envelopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.health_e2ee_devices(id) on delete cascade,
  sender_device_id uuid references public.health_e2ee_devices(id) on delete set null,
  envelope text not null,
  nonce text not null,
  algorithm text not null default 'ECDH-P256/AES-256-GCM',
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now()
);
create index if not exists health_e2ee_envelopes_device_idx on public.health_e2ee_key_envelopes (user_id, device_id, created_at desc);
alter table public.health_e2ee_key_envelopes enable row level security;
revoke all on public.health_e2ee_key_envelopes from anon;
grant select, insert, delete on public.health_e2ee_key_envelopes to authenticated;
create policy health_e2ee_envelopes_select_own on public.health_e2ee_key_envelopes for select to authenticated using ((select auth.uid()) = user_id);
create policy health_e2ee_envelopes_insert_own on public.health_e2ee_key_envelopes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy health_e2ee_envelopes_delete_own on public.health_e2ee_key_envelopes for delete to authenticated using ((select auth.uid()) = user_id);