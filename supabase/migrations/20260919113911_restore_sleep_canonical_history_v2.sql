create temp table _sleep_recovery on commit drop as
select user_id, jsonb_object_agg(day, entry) as sleep_value
from (
  select s.user_id, e.day, e.entry,
         row_number() over (
           partition by s.user_id, e.day
           order by case s.key when 'pace.domain.sleep' then 1 when 'pace.sleep' then 2 else 3 end
         ) as rn
  from user_state s
  cross join lateral jsonb_each(
    case
      when s.key = 'pace.domain.sleep' and jsonb_typeof(s.value->'value') = 'object' then s.value->'value'
      else s.value
    end
  ) e(day, entry)
  where s.key in ('lt.sleep','pace.sleep','pace.domain.sleep')
    and e.day ~ '^\d{4}-\d{2}-\d{2}$'
    and jsonb_typeof(e.entry) = 'object'
    and coalesce((e.entry->>'hours')::numeric, 0) > 0
) ranked
where rn = 1
group by user_id;

update user_state u
set value = r.sleep_value, updated_at = now()
from _sleep_recovery r
where u.user_id = r.user_id and u.key = 'pace.sleep';

update user_state u
set value = jsonb_build_object(
  'version', 1,
  'updatedAt', now(),
  'recovered', true,
  'value', r.sleep_value
),
updated_at = now()
from _sleep_recovery r
where u.user_id = r.user_id and u.key = 'pace.domain.sleep';