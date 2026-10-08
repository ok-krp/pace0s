-- Enforce health cloud-sync consent at the database boundary for privileged
-- SECURITY DEFINER health-data maintenance RPCs. These functions write to
-- health_samples_e2ee and therefore cannot rely on the caller's table RLS.

create or replace function public.backfill_health_e2ee_dedupe_hashes(p_updates jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  updated_count integer := 0;
  row_id uuid;
  hash_value text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_current_health_e2ee_consent() then
    raise exception 'Health E2EE cloud-sync consent is required';
  end if;

  if jsonb_typeof(p_updates) <> 'array' then
    raise exception 'Invalid backfill payload';
  end if;

  if jsonb_array_length(p_updates) > 500 then
    raise exception 'Backfill batch too large';
  end if;

  for item in select value from jsonb_array_elements(p_updates) loop
    row_id := (item->>'id')::uuid;
    hash_value := item->>'dedupe_hash';

    if hash_value is null or hash_value !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid dedupe hash';
    end if;

    update public.health_samples_e2ee as target
    set dedupe_hash = hash_value
    where target.id = row_id
      and target.user_id = auth.uid()
      and target.dedupe_hash is null
      and not exists (
        select 1
        from public.health_samples_e2ee as existing
        where existing.user_id = auth.uid()
          and existing.dedupe_hash = hash_value
          and existing.id <> row_id
      );

    updated_count := updated_count + sql%rowcount;
  end loop;

  return updated_count;
end;
$$;

revoke all on function public.backfill_health_e2ee_dedupe_hashes(jsonb) from public;
grant execute on function public.backfill_health_e2ee_dedupe_hashes(jsonb) to authenticated;

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
  dedupe_hash_value text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_current_health_e2ee_consent() then
    raise exception 'Health E2EE cloud-sync consent is required';
  end if;

  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Invalid migration payload';
  end if;

  if jsonb_array_length(p_records) > 100 then
    raise exception 'Migration chunk too large';
  end if;

  for record in select value from jsonb_array_elements(p_records) loop
    legacy_id := (record->>'legacy_id')::uuid;
    dedupe_hash_value := record->>'dedupe_hash';

    if dedupe_hash_value is null or dedupe_hash_value !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid dedupe hash';
    end if;

    if not exists (
      select 1
      from public.health_legacy_migration_map
      where legacy_sample_id = legacy_id
        and user_id = auth.uid()
    ) then
      insert into public.health_samples_e2ee(
        user_id,
        ciphertext,
        nonce,
        algorithm,
        key_version,
        dedupe_hash
      )
      values (
        auth.uid(),
        record->>'ciphertext',
        record->>'nonce',
        'AES-256-GCM',
        (record->>'key_version')::integer,
        dedupe_hash_value
      );

      insert into public.health_legacy_migration_map(legacy_sample_id, user_id)
      values (legacy_id, auth.uid());

      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.migrate_health_legacy_chunk(jsonb) from public;
grant execute on function public.migrate_health_legacy_chunk(jsonb) to authenticated;
