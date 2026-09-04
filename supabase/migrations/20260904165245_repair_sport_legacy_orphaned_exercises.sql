-- Rebuild missing Sport exercise metadata from the user's own successful Sport
-- action records. This repairs the pre-normalized state without deleting data.
with exercise_actions as (
  select distinct on (user_id, payload->>'id')
    user_id,
    (payload->>'id')::uuid as exercise_id,
    payload->>'name' as name,
    payload->>'muscle' as muscle,
    payload->>'equipment' as equipment,
    payload->>'notes' as notes,
    nullif(payload->>'defaultSets', '')::integer as default_sets,
    nullif(payload->>'defaultReps', '')::integer as default_reps,
    nullif(payload->>'defaultWeight', '')::numeric as default_weight,
    nullif(payload->>'restSec', '')::integer as rest_sec
  from public.ai_action_log
  where action_type = 'create_sport_exercise'
    and status = 'executed'
    and payload->>'id' is not null
    and payload->>'name' is not null
    and payload->>'muscle' is not null
  order by user_id, payload->>'id', created_at desc
)
insert into public.sport_exercises (
  id, user_id, name, muscle, equipment, notes, default_sets, default_reps, default_weight, rest_sec
)
select exercise_id, user_id, name, muscle, equipment, notes, default_sets, default_reps, default_weight, rest_sec
from exercise_actions ea
where not exists (
  select 1 from public.sport_exercises se
  where se.id = ea.exercise_id and se.user_id = ea.user_id
);

-- Reconcile the client-facing local state so the web UI receives all recovered
-- exercises after its next cloud pull. Existing entries are preserved verbatim.
with exercise_actions as (
  select distinct on (user_id, payload->>'id')
    user_id,
    payload->>'id' as exercise_id,
    jsonb_build_object(
      'id', payload->>'id',
      'name', payload->>'name',
      'muscle', payload->>'muscle',
      'equipment', payload->'equipment',
      'notes', payload->'notes',
      'defaultSets', nullif(payload->>'defaultSets', '')::integer,
      'defaultReps', nullif(payload->>'defaultReps', '')::integer,
      'defaultWeight', nullif(payload->>'defaultWeight', '')::numeric,
      'restSec', nullif(payload->>'restSec', '')::integer
    ) as exercise_value
  from public.ai_action_log
  where action_type = 'create_sport_exercise'
    and status = 'executed'
    and payload->>'id' is not null
    and payload->>'name' is not null
    and payload->>'muscle' is not null
  order by user_id, payload->>'id', created_at desc
)
update public.user_state us
set value = us.value || coalesce(
  (
    select jsonb_agg(ea.exercise_value order by ea.exercise_id)
    from exercise_actions ea
    where ea.user_id = us.user_id
      and not exists (
        select 1
        from jsonb_array_elements(us.value) existing
        where existing->>'id' = ea.exercise_id
      )
  ),
  '[]'::jsonb
),
updated_at = now(),
updated_by = 'sport-legacy-repair'
where us.key = 'pace.sport.exercises'
  and jsonb_typeof(us.value) = 'array'
  and exists (
    select 1
    from exercise_actions ea
    where ea.user_id = us.user_id
      and not exists (
        select 1
        from jsonb_array_elements(us.value) existing
        where existing->>'id' = ea.exercise_id
      )
  );

-- Rebuild every missing program item from the already-existing
-- pace.sport.programs state, preserving its exact sets/reps/weight targets.
with program_items as (
  select
    us.user_id,
    (p.value->>'id')::uuid as program_id,
    (item.value->>'exerciseId')::uuid as exercise_id,
    (item.ordinality - 1)::integer as position,
    coalesce(nullif(item.value->>'sets','')::integer, 3) as sets,
    coalesce(nullif(item.value->>'reps','')::integer, 8) as reps,
    nullif(item.value->>'weight','')::numeric as weight,
    nullif(item.value->>'restSec','')::integer as rest_sec
  from public.user_state us
  cross join lateral jsonb_array_elements(us.value) p(value)
  cross join lateral jsonb_array_elements(p.value->'items') with ordinality item(value, ordinality)
  where us.key = 'pace.sport.programs'
    and jsonb_typeof(us.value) = 'array'
)
insert into public.sport_program_items (program_id, exercise_id, position, sets, reps, weight, rest_sec)
select pi.program_id, pi.exercise_id, pi.position, pi.sets, pi.reps, pi.weight, pi.rest_sec
from program_items pi
join public.sport_programs sp on sp.id = pi.program_id and sp.user_id = pi.user_id
join public.sport_exercises se on se.id = pi.exercise_id and se.user_id = pi.user_id
where not exists (
  select 1
  from public.sport_program_items existing
  where existing.program_id = pi.program_id
    and existing.exercise_id = pi.exercise_id
);