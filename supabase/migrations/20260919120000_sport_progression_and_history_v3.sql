create table if not exists public.sport_progression_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.sport_exercises(id) on delete cascade,
  target_sets integer not null check (target_sets > 0),
  target_reps integer not null check (target_reps > 0),
  target_weight numeric not null default 0 check (target_weight >= 0),
  strategy text not null default 'double_progression',
  rationale text,
  based_on_session_id uuid references public.sport_workout_sessions(id) on delete set null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, exercise_id)
);

create index if not exists sport_progression_targets_user_idx on public.sport_progression_targets(user_id);
create index if not exists sport_progression_targets_exercise_idx on public.sport_progression_targets(exercise_id);

alter table public.sport_progression_targets enable row level security;

drop policy if exists sport_progression_targets_select_own on public.sport_progression_targets;
create policy sport_progression_targets_select_own on public.sport_progression_targets for select using ((select auth.uid()) = user_id);

drop policy if exists sport_progression_targets_insert_own on public.sport_progression_targets;
create policy sport_progression_targets_insert_own on public.sport_progression_targets for insert with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.sport_exercises e where e.id = sport_progression_targets.exercise_id and e.user_id = (select auth.uid())
  )
);

drop policy if exists sport_progression_targets_update_own on public.sport_progression_targets;
create policy sport_progression_targets_update_own on public.sport_progression_targets for update
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.sport_exercises e where e.id = sport_progression_targets.exercise_id and e.user_id = (select auth.uid())
  )
);

drop policy if exists sport_progression_targets_delete_own on public.sport_progression_targets;
create policy sport_progression_targets_delete_own on public.sport_progression_targets for delete using ((select auth.uid()) = user_id);

with legacy_sessions as (
  select us.user_id, x as session
  from public.user_state us
  cross join lateral jsonb_array_elements(case when jsonb_typeof(us.value) = 'array' then us.value else '[]'::jsonb end) x
  where us.key = 'pace.sport.sessions'
)
insert into public.sport_workout_sessions (id,user_id,program_id,name,workout_date,started_at,ended_at,duration_min,notes,is_temporary)
select
  (session->>'id')::uuid, user_id, nullif(session->>'programId','')::uuid, coalesce(session->>'name','Séance'),
  coalesce(session->>'date',current_date::text)::date, to_timestamp((session->>'startedAt')::double precision/1000.0),
  case when nullif(session->>'endedAt','') is null then null else to_timestamp((session->>'endedAt')::double precision/1000.0) end,
  nullif(session->>'durationMin','')::integer, nullif(session->>'notes',''), false
from legacy_sessions where nullif(session->>'id','') is not null
on conflict (id) do nothing;

with legacy_sessions as (
  select us.user_id, x as session
  from public.user_state us
  cross join lateral jsonb_array_elements(case when jsonb_typeof(us.value) = 'array' then us.value else '[]'::jsonb end) x
  where us.key = 'pace.sport.sessions'
)
insert into public.sport_workout_exercises (id,session_id,exercise_id,position,note)
select md5((ls.session->>'id')||':'||(ex->>'exerciseId')||':'||(pos-1))::uuid,
       (ls.session->>'id')::uuid,(ex->>'exerciseId')::uuid,pos-1,nullif(ex->>'note','')
from legacy_sessions ls
cross join lateral jsonb_array_elements(case when jsonb_typeof(ls.session->'exercises')='array' then ls.session->'exercises' else '[]'::jsonb end)
with ordinality as e(ex,pos)
where nullif(ls.session->>'id','') is not null and nullif(ex->>'exerciseId','') is not null
  and exists (select 1 from public.sport_workout_sessions s where s.id=(ls.session->>'id')::uuid and s.user_id=ls.user_id)
on conflict (session_id,position) do update set exercise_id=excluded.exercise_id,note=excluded.note;

with legacy_sessions as (
  select us.user_id, x as session
  from public.user_state us
  cross join lateral jsonb_array_elements(case when jsonb_typeof(us.value)='array' then us.value else '[]'::jsonb end) x
  where us.key='pace.sport.sessions'
)
insert into public.sport_workout_sets (id,workout_exercise_id,set_number,reps,weight,done)
select md5((ls.session->>'id')||':'||(ex->>'exerciseId')||':'||(expos-1)||':'||setpos)::uuid,
       md5((ls.session->>'id')||':'||(ex->>'exerciseId')||':'||(expos-1))::uuid,
       setpos,coalesce((s->>'reps')::integer,0),coalesce((s->>'weight')::numeric,0),coalesce((s->>'done')::boolean,false)
from legacy_sessions ls
cross join lateral jsonb_array_elements(case when jsonb_typeof(ls.session->'exercises')='array' then ls.session->'exercises' else '[]'::jsonb end)
with ordinality as e(ex,expos)
cross join lateral jsonb_array_elements(case when jsonb_typeof(e.ex->'sets')='array' then e.ex->'sets' else '[]'::jsonb end)
with ordinality as ss(s,setpos)
where nullif(ls.session->>'id','') is not null and nullif(e.ex->>'exerciseId','') is not null
  and exists (select 1 from public.sport_workout_exercises we where we.id=md5((ls.session->>'id')||':'||(e.ex->>'exerciseId')||':'||(expos-1))::uuid)
on conflict (id) do update set reps=excluded.reps,weight=excluded.weight,done=excluded.done;
