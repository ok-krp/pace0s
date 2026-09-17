-- Repair keys produced by recursive `pace.domain.` prefixing.
-- Keep the newest row for each user/canonical domain key, then remove duplicates.
do $$
declare
  r record;
  canonical_key text;
begin
  for r in
    select id, user_id, key, value, updated_at
    from public.user_state
    where key like 'pace.domain.domain.%'
    order by user_id, key, updated_at desc
  loop
    canonical_key := r.key;
    while canonical_key like 'pace.domain.domain.%' loop
      canonical_key := 'pace.domain.' || substr(canonical_key, length('pace.domain.domain.') + 1);
    end loop;

    if exists (
      select 1
      from public.user_state u
      where u.user_id = r.user_id
        and u.key = canonical_key
        and u.id <> r.id
        and u.updated_at >= r.updated_at
    ) then
      delete from public.user_state where id = r.id;
    else
      delete from public.user_state
      where user_id = r.user_id
        and key = canonical_key
        and id <> r.id
        and updated_at <= r.updated_at;
      update public.user_state
      set key = canonical_key,
          updated_at = greatest(updated_at, r.updated_at)
      where id = r.id;
    end if;
  end loop;
end $$;

-- Re-run a bounded normalization for any rows still carrying repeated domain segments.
do $$
declare
  r record;
  canonical_key text;
begin
  for r in
    select id, user_id, key, updated_at
    from public.user_state
    where key like 'pace.domain.domain.%'
    order by user_id, updated_at desc
  loop
    canonical_key := r.key;
    while canonical_key like 'pace.domain.domain.%' loop
      canonical_key := 'pace.domain.' || substr(canonical_key, length('pace.domain.domain.') + 1);
    end loop;
    if not exists (select 1 from public.user_state u where u.user_id = r.user_id and u.key = canonical_key and u.id <> r.id) then
      update public.user_state set key = canonical_key where id = r.id;
    else
      delete from public.user_state where id = r.id;
    end if;
  end loop;
end $$;
