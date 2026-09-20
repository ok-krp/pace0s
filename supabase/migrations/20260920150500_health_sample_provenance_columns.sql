alter table public.health_samples
  add column if not exists source_id text,
  add column if not exists external_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists health_samples_user_external_id_idx
  on public.health_samples (user_id, external_id)
  where external_id is not null;
