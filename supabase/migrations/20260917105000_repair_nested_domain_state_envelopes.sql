-- Repair only the duplicated domain-record envelope produced by an older sync path.
-- The inner `value` is the actual domain payload; preserve the outer record metadata.
do $$
declare
  item record;
  current_value jsonb;
  depth integer;
begin
  for item in
    select id, value
    from public.user_state
    where key like 'pace.domain.%'
      and value->>'version' = '1'
      and value->>'updatedAt' is not null
      and value->>'mutationId' is not null
  loop
    current_value := item.value;
    for depth in 1..8 loop
      exit when jsonb_typeof(current_value->'value') <> 'object'
        or current_value->'value'->>'version' <> '1'
        or current_value->'value'->>'updatedAt' is null
        or current_value->'value'->>'mutationId' is null;
      current_value := jsonb_set(current_value, '{value}', current_value->'value'->'value', true);
    end loop;

    if current_value is distinct from item.value then
      update public.user_state
      set value = current_value,
          updated_at = now()
      where id = item.id;
    end if;
  end loop;
end $$;
