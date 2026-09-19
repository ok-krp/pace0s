with pairs as (
  select l.user_id, replace(l.key,'lt.','pace.') as key, l.value legacy_value, c.value canonical_value
  from public.user_state l
  left join public.user_state c on c.user_id=l.user_id and c.key=replace(l.key,'lt.','pace.')
  where l.key like 'lt.%'
),
merged as (
  select user_id,key,
    case
      when canonical_value is null then legacy_value
      when jsonb_typeof(legacy_value)='object' and jsonb_typeof(canonical_value)='object' then legacy_value || canonical_value
      when jsonb_typeof(legacy_value)='array' and jsonb_typeof(canonical_value)='array' then
        canonical_value || coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(legacy_value) x
          where not exists (
            select 1 from jsonb_array_elements(canonical_value) y
            where (x->>'id') is not null and (x->>'id') <> '' and x->>'id'=y->>'id'
          )
          and not exists (
            select 1 from jsonb_array_elements(canonical_value) y
            where (x->>'id') is null and x=y
          )
        ), '[]'::jsonb)
      else canonical_value
    end value
  from pairs
)
insert into public.user_state (user_id,key,value,updated_at,updated_by)
select user_id,key,value,now(),'state_recovery_v4'
from merged
where value is not null
on conflict (user_id,key) do update
set value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
where public.user_state.value is distinct from excluded.value;
