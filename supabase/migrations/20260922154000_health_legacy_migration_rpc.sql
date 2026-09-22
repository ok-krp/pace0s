create table if not exists public.health_legacy_migration_map (
  legacy_sample_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  migrated_at timestamptz not null default now()
);
alter table public.health_legacy_migration_map enable row level security;
revoke all on public.health_legacy_migration_map from anon;
revoke all on public.health_legacy_migration_map from authenticated;

create or replace function public.migrate_health_legacy_chunk(p_records jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  record jsonb;
  legacy_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_records) <> 'array' then raise exception 'Invalid migration payload'; end if;
  if jsonb_array_length(p_records) > 100 then raise exception 'Migration chunk too large'; end if;

  for record in select value from jsonb_array_elements(p_records) loop
    legacy_id := (record->>'legacy_id')::uuid;
    if not exists (
      select 1 from public.health_legacy_migration_map
      where legacy_sample_id = legacy_id and user_id = auth.uid()
    ) then
      insert into public.health_samples_e2ee(
        user_id, ciphertext, nonce, algorithm, key_version
      ) values (
        auth.uid(),
        record->>'ciphertext',
        record->>'nonce',
        'AES-256-GCM',
        (record->>'key_version')::integer
      );
      insert into public.health_legacy_migration_map(legacy_sample_id,user_id)
        values (legacy_id, auth.uid());
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.migrate_health_legacy_chunk(jsonb) from public;
grant execute on function public.migrate_health_legacy_chunk(jsonb) to authenticated;