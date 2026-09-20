-- Real client-side E2EE storage for health samples.
-- The server stores only ciphertext + nonce. It never receives the plaintext
-- health sample or the encryption key.

create table if not exists public.health_samples_e2ee (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  nonce text not null,
  algorithm text not null default 'AES-256-GCM',
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now()
);

create index if not exists health_samples_e2ee_user_created_idx
  on public.health_samples_e2ee (user_id, created_at desc);

alter table public.health_samples_e2ee enable row level security;
revoke all on public.health_samples_e2ee from anon;
grant select, insert, delete on public.health_samples_e2ee to authenticated;

drop policy if exists health_samples_e2ee_select_own on public.health_samples_e2ee;
create policy health_samples_e2ee_select_own
on public.health_samples_e2ee for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists health_samples_e2ee_insert_own on public.health_samples_e2ee;
create policy health_samples_e2ee_insert_own
on public.health_samples_e2ee for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists health_samples_e2ee_delete_own on public.health_samples_e2ee;
create policy health_samples_e2ee_delete_own
on public.health_samples_e2ee for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Prevent accidental plaintext health ingestion through the legacy table.
revoke insert, update, delete on public.health_samples from authenticated;
