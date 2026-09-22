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

    update public.health_samples_e2ee
    set dedupe_hash = hash_value
    where id = row_id
      and user_id = auth.uid()
      and dedupe_hash is null;

    updated_count := updated_count + sql%rowcount;
  end loop;

  return updated_count;
end;
$$;

revoke all on function public.backfill_health_e2ee_dedupe_hashes(jsonb) from public;
grant execute on function public.backfill_health_e2ee_dedupe_hashes(jsonb) to authenticated;
