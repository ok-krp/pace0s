-- Repair stale legacy migration markers without deleting plaintext or replacing user data.
-- A marker is only complete when the matching encrypted dedupe hash exists.
-- Keep the RPC scoped to the authenticated owner and require current Health E2EE consent.

create or replace function public.migrate_health_legacy_chunk(p_records jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inserted_count integer := 0;
  inserted_this integer := 0;
  record jsonb;
  legacy_id uuid;
  dedupe_hash_value text;
  existing_map_user uuid;
  key_version_value integer;
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
    key_version_value := (record->>'key_version')::integer;

    if legacy_id is null then
      raise exception 'Legacy sample id is required';
    end if;

    if dedupe_hash_value is null or dedupe_hash_value !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid dedupe hash';
    end if;

    if coalesce(record->>'ciphertext','') = ''
       or coalesce(record->>'nonce','') = ''
       or key_version_value is null
       or key_version_value < 1 then
      raise exception 'Invalid encrypted health record';
    end if;

    if not exists (
      select 1
      from public.health_samples as legacy
      where legacy.id = legacy_id
        and legacy.user_id = auth.uid()
    ) then
      raise exception 'Legacy sample not found or not owned by authenticated user';
    end if;

    existing_map_user := null;
    select migration_map.user_id
      into existing_map_user
    from public.health_legacy_migration_map as migration_map
    where migration_map.legacy_sample_id = legacy_id
    for update;

    if existing_map_user is not null and existing_map_user <> auth.uid() then
      raise exception 'Legacy migration marker belongs to another user';
    end if;

    -- A map row alone is not proof that ciphertext still exists.
    -- Retry missing ciphertext, while the unique blind index makes retries idempotent.
    if not exists (
      select 1
      from public.health_samples_e2ee as encrypted
      where encrypted.user_id = auth.uid()
        and encrypted.dedupe_hash = dedupe_hash_value
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
        key_version_value,
        dedupe_hash_value
      )
      on conflict (user_id, dedupe_hash) do nothing;

      get diagnostics inserted_this = row_count;
      inserted_count := inserted_count + inserted_this;
    end if;

    insert into public.health_legacy_migration_map(legacy_sample_id, user_id)
    values (legacy_id, auth.uid())
    on conflict (legacy_sample_id)
    do update set migrated_at = now()
    where public.health_legacy_migration_map.user_id = excluded.user_id;

    if not found then
      raise exception 'Legacy migration marker belongs to another user';
    end if;
  end loop;

  return inserted_count;
end;
$function$;

revoke all on function public.migrate_health_legacy_chunk(jsonb) from public;
revoke all on function public.migrate_health_legacy_chunk(jsonb) from anon;
grant execute on function public.migrate_health_legacy_chunk(jsonb) to authenticated;
