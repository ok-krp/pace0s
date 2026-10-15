-- Safe replacement for the legacy health migration path.
-- The old one-argument RPC can assign a batch to whichever account is active
-- at call time and cannot prove that the plaintext source rows were migrated.
alter table public.health_legacy_migration_map
  add column if not exists dedupe_hash text;

create or replace function public.has_current_health_e2ee_consent()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $
  select
    coalesce((
      select c.granted
      from public.consent_records c
      where c.user_id = (select auth.uid())
        and c.consent_type = 'health_data'
      order by c.created_at desc, c.id desc
      limit 1
    ), false)
    and coalesce((
      select c.granted
      from public.consent_records c
      where c.user_id = (select auth.uid())
        and c.consent_type = 'health_cloud_sync'
      order by c.created_at desc, c.id desc
      limit 1
    ), false);
$;

revoke all on function public.has_current_health_e2ee_consent() from public, anon;
grant execute on function public.has_current_health_e2ee_consent() to authenticated;

create or replace function public.migrate_health_legacy_chunk_for_user(
  p_expected_user_id uuid,
  p_records jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  mapped_count integer := 0;
  record jsonb;
  legacy_id uuid;
  dedupe_hash_value text;
  existing_hash text;
  inserted_rows integer := 0;
begin
  if auth.uid() is null or auth.uid() <> p_expected_user_id then
    raise exception 'Authenticated account changed during migration';
  end if;
  if not public.has_current_health_e2ee_consent() then
    raise exception 'Health and cloud-sync consent are required';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 100 then
    raise exception 'Invalid migration chunk';
  end if;

  for record in select value from jsonb_array_elements(p_records) loop
    legacy_id := (record->>'legacy_id')::uuid;
    dedupe_hash_value := record->>'dedupe_hash';

    if dedupe_hash_value is null or dedupe_hash_value !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid dedupe hash';
    end if;
    if coalesce(record->>'ciphertext', '') = ''
      or coalesce(record->>'nonce', '') = ''
      or coalesce((record->>'key_version')::integer, 0) < 1
      or coalesce((record->>'key_version')::integer, 0) > 100 then
      raise exception 'Invalid encrypted health payload';
    end if;
    if not exists (
      select 1 from public.health_samples legacy
      where legacy.id = legacy_id and legacy.user_id = auth.uid()
    ) then
      raise exception 'Legacy source row does not belong to authenticated user';
    end if;

    select migration.dedupe_hash
      into existing_hash
      from public.health_legacy_migration_map migration
      where migration.legacy_sample_id = legacy_id
        and migration.user_id = auth.uid();

    if found then
      -- Older migration maps have no dedupe hash and their corresponding
      -- encrypted row cannot be identified safely from the legacy ID alone.
      -- Never backfill the map hash by assumption: retain plaintext and require
      -- an explicit reconciliation path for those pre-existing mappings.
      if existing_hash is null then
        raise exception 'Legacy mapping predates verified dedupe; reconciliation required';
      end if;
      if existing_hash <> dedupe_hash_value then
        raise exception 'Legacy migration mapping hash mismatch';
      end if;
    else
      insert into public.health_samples_e2ee(
        user_id, ciphertext, nonce, algorithm, key_version, dedupe_hash
      )
      values (
        auth.uid(),
        record->>'ciphertext',
        record->>'nonce',
        'AES-256-GCM',
        (record->>'key_version')::integer,
        dedupe_hash_value
      )
      on conflict (user_id, dedupe_hash) do nothing;
      get diagnostics inserted_rows = row_count;

      -- Without a prior migration-map row, a dedupe collision might represent
      -- a different value for the same logical identity. Never map or delete
      -- the plaintext source based on identity alone.
      if inserted_rows = 0 then
        raise exception 'Unmapped dedupe collision requires payload verification';
      end if;

      insert into public.health_legacy_migration_map(
        legacy_sample_id, user_id, dedupe_hash
      )
      values (legacy_id, auth.uid(), dedupe_hash_value);
    end if;

    -- A mapping is valid only while the corresponding encrypted identity exists.
    if not exists (
      select 1 from public.health_samples_e2ee encrypted
      where encrypted.user_id = auth.uid()
        and encrypted.dedupe_hash = dedupe_hash_value
    ) then
      raise exception 'Encrypted destination row is missing';
    end if;
    mapped_count := mapped_count + 1;
  end loop;

  return mapped_count;
end;
$$;

create or replace function public.delete_migrated_health_legacy_chunk(
  p_expected_user_id uuid,
  p_legacy_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer := 0;
begin
  if auth.uid() is null or auth.uid() <> p_expected_user_id then
    raise exception 'Authenticated account changed during migration cleanup';
  end if;
  if not public.has_current_health_e2ee_consent() then
    raise exception 'Health and cloud-sync consent are required';
  end if;
  if coalesce(array_length(p_legacy_ids, 1), 0) < 1
    or array_length(p_legacy_ids, 1) > 100 then
    raise exception 'Invalid cleanup chunk';
  end if;

  if exists (
    select requested.id
    from unnest(p_legacy_ids) as requested(id)
    left join public.health_legacy_migration_map migration
      on migration.legacy_sample_id = requested.id
      and migration.user_id = auth.uid()
    left join public.health_samples_e2ee encrypted
      on encrypted.user_id = auth.uid()
      and encrypted.dedupe_hash = migration.dedupe_hash
    where migration.legacy_sample_id is null
      or migration.dedupe_hash is null
      or encrypted.id is null
  ) then
    raise exception 'Refusing to delete plaintext without a verified encrypted destination';
  end if;

  delete from public.health_samples legacy
  where legacy.user_id = auth.uid()
    and legacy.id = any(p_legacy_ids)
    and exists (
      select 1 from public.health_legacy_migration_map migration
      join public.health_samples_e2ee encrypted
        on encrypted.user_id = migration.user_id
        and encrypted.dedupe_hash = migration.dedupe_hash
      where migration.legacy_sample_id = legacy.id
        and migration.user_id = auth.uid()
    );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.migrate_health_legacy_chunk_for_user(uuid, jsonb) from public, anon;
grant execute on function public.migrate_health_legacy_chunk_for_user(uuid, jsonb) to authenticated;
revoke all on function public.delete_migrated_health_legacy_chunk(uuid, uuid[]) from public, anon;
grant execute on function public.delete_migrated_health_legacy_chunk(uuid, uuid[]) to authenticated;

-- Disable the unsafe one-argument client path. Older clients will fail closed
-- and retain plaintext rather than continue a migration without account binding.
revoke all on function public.migrate_health_legacy_chunk(jsonb) from authenticated;
