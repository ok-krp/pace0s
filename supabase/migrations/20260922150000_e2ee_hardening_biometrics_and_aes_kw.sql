create table if not exists public.user_biometrics_e2ee (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  nonce text not null,
  algorithm text not null default 'AES-256-GCM',
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_biometrics_e2ee_algorithm_check check (algorithm = 'AES-256-GCM')
);

create unique index if not exists user_biometrics_e2ee_user_idx
  on public.user_biometrics_e2ee (user_id);

alter table public.user_biometrics_e2ee enable row level security;
revoke all on public.user_biometrics_e2ee from anon;
grant select, insert, update, delete on public.user_biometrics_e2ee to authenticated;

drop policy if exists user_biometrics_e2ee_select_own on public.user_biometrics_e2ee;
create policy user_biometrics_e2ee_select_own on public.user_biometrics_e2ee
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists user_biometrics_e2ee_insert_own on public.user_biometrics_e2ee;
create policy user_biometrics_e2ee_insert_own on public.user_biometrics_e2ee
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists user_biometrics_e2ee_update_own on public.user_biometrics_e2ee;
create policy user_biometrics_e2ee_update_own on public.user_biometrics_e2ee
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_biometrics_e2ee_delete_own on public.user_biometrics_e2ee;
create policy user_biometrics_e2ee_delete_own on public.user_biometrics_e2ee
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.health_e2ee_key_envelopes alter column nonce drop not null;

alter table public.health_e2ee_key_envelopes
  drop constraint if exists health_e2ee_key_envelopes_algorithm_check;

alter table public.health_e2ee_key_envelopes
  add constraint health_e2ee_key_envelopes_algorithm_check
  check (algorithm in ('ECDH-P256/AES-256-GCM', 'ECDH-P256/AES-256-KW'));

alter table public.health_samples_e2ee
  drop constraint if exists health_samples_e2ee_algorithm_check;

alter table public.health_samples_e2ee
  add constraint health_samples_e2ee_algorithm_check
  check (algorithm = 'AES-256-GCM');
