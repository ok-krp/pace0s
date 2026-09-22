alter table public.health_samples_e2ee
  add column if not exists dedupe_hash text;

create unique index if not exists health_samples_e2ee_user_dedupe_hash_uidx
  on public.health_samples_e2ee (user_id, dedupe_hash);

comment on column public.health_samples_e2ee.dedupe_hash is
  'Zero-knowledge blind index: HMAC-SHA256 over canonical health sample identity, derived from the client-side Health Master Key. Nullable until client backfill completes.';
