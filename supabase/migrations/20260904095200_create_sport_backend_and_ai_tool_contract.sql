create table if not exists public.sport_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  muscle text not null,
  equipment text,
  notes text,
  default_sets integer,
  default_reps integer,
  default_weight numeric,
  rest_sec integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.sport_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text not null default '🏋️',
  days integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (days <@ array[0,1,2,3,4,5,6]::integer[])
);

create table if not exists public.sport_program_items (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.sport_programs(id) on delete cascade,
  exercise_id uuid not null references public.sport_exercises(id) on delete restrict,
  position integer not null default 0,
  sets integer not null default 3 check (sets > 0),
  reps integer not null default 8 check (reps > 0),
  weight numeric check (weight is null or weight >= 0),
  rest_sec integer check (rest_sec is null or rest_sec >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, position)
);

create table if not exists public.sport_workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid references public.sport_programs(id) on delete set null,
  name text not null,
  workout_date date not null default current_date,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_min integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sport_workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sport_workout_sessions(id) on delete cascade,
  exercise_id uuid not null references public.sport_exercises(id) on delete restrict,
  position integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (session_id, position)
);

create table if not exists public.sport_workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.sport_workout_exercises(id) on delete cascade,
  set_number integer not null,
  reps integer not null check (reps > 0),
  weight numeric not null default 0 check (weight >= 0),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workout_exercise_id, set_number)
);

create index if not exists sport_exercises_user_id_idx on public.sport_exercises(user_id);
create index if not exists sport_exercises_user_name_idx on public.sport_exercises(user_id,name);
create index if not exists sport_programs_user_id_idx on public.sport_programs(user_id);
create index if not exists sport_programs_user_updated_idx on public.sport_programs(user_id,updated_at desc);
create index if not exists sport_program_items_program_id_idx on public.sport_program_items(program_id);
create index if not exists sport_program_items_exercise_id_idx on public.sport_program_items(exercise_id);
create index if not exists sport_program_items_program_position_idx on public.sport_program_items(program_id,position);
create index if not exists sport_workout_sessions_user_date_idx on public.sport_workout_sessions(user_id,workout_date desc);
create index if not exists sport_workout_sessions_program_id_idx on public.sport_workout_sessions(program_id);
create index if not exists sport_workout_sessions_user_started_idx on public.sport_workout_sessions(user_id,started_at desc);
create index if not exists sport_workout_exercises_session_id_idx on public.sport_workout_exercises(session_id);
create index if not exists sport_workout_exercises_exercise_id_idx on public.sport_workout_exercises(exercise_id);
create index if not exists sport_workout_exercises_session_position_idx on public.sport_workout_exercises(session_id,position);
create index if not exists sport_workout_sets_exercise_id_idx on public.sport_workout_sets(workout_exercise_id);
create index if not exists sport_workout_sets_exercise_number_idx on public.sport_workout_sets(workout_exercise_id,set_number);

alter table public.sport_exercises enable row level security;
alter table public.sport_programs enable row level security;
alter table public.sport_program_items enable row level security;
alter table public.sport_workout_sessions enable row level security;
alter table public.sport_workout_exercises enable row level security;
alter table public.sport_workout_sets enable row level security;

create policy sport_exercises_select_own on public.sport_exercises for select to authenticated using ((select auth.uid()) = user_id);
create policy sport_exercises_insert_own on public.sport_exercises for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sport_exercises_update_own on public.sport_exercises for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sport_exercises_delete_own on public.sport_exercises for delete to authenticated using ((select auth.uid()) = user_id);

create policy sport_programs_select_own on public.sport_programs for select to authenticated using ((select auth.uid()) = user_id);
create policy sport_programs_insert_own on public.sport_programs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sport_programs_update_own on public.sport_programs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sport_programs_delete_own on public.sport_programs for delete to authenticated using ((select auth.uid()) = user_id);

create policy sport_program_items_select_own on public.sport_program_items for select to authenticated using (exists (select 1 from public.sport_programs p where p.id = program_id and p.user_id = (select auth.uid())));
create policy sport_program_items_insert_own on public.sport_program_items for insert to authenticated with check (exists (select 1 from public.sport_programs p where p.id = program_id and p.user_id = (select auth.uid())) and exists (select 1 from public.sport_exercises e where e.id = exercise_id and e.user_id = (select auth.uid())));
create policy sport_program_items_update_own on public.sport_program_items for update to authenticated using (exists (select 1 from public.sport_programs p where p.id = program_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.sport_programs p where p.id = program_id and p.user_id = (select auth.uid())) and exists (select 1 from public.sport_exercises e where e.id = exercise_id and e.user_id = (select auth.uid())));
create policy sport_program_items_delete_own on public.sport_program_items for delete to authenticated using (exists (select 1 from public.sport_programs p where p.id = program_id and p.user_id = (select auth.uid())));

create policy sport_sessions_select_own on public.sport_workout_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy sport_sessions_insert_own on public.sport_workout_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sport_sessions_update_own on public.sport_workout_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sport_sessions_delete_own on public.sport_workout_sessions for delete to authenticated using ((select auth.uid()) = user_id);

create policy sport_workout_exercises_select_own on public.sport_workout_exercises for select to authenticated using (exists (select 1 from public.sport_workout_sessions s where s.id = session_id and s.user_id = (select auth.uid())));
create policy sport_workout_exercises_insert_own on public.sport_workout_exercises for insert to authenticated with check (exists (select 1 from public.sport_workout_sessions s where s.id = session_id and s.user_id = (select auth.uid())) and exists (select 1 from public.sport_exercises e where e.id = exercise_id and e.user_id = (select auth.uid())));
create policy sport_workout_exercises_update_own on public.sport_workout_exercises for update to authenticated using (exists (select 1 from public.sport_workout_sessions s where s.id = session_id and s.user_id = (select auth.uid()))) with check (exists (select 1 from public.sport_workout_sessions s where s.id = session_id and s.user_id = (select auth.uid())) and exists (select 1 from public.sport_exercises e where e.id = exercise_id and e.user_id = (select auth.uid())));
create policy sport_workout_exercises_delete_own on public.sport_workout_exercises for delete to authenticated using (exists (select 1 from public.sport_workout_sessions s where s.id = session_id and s.user_id = (select auth.uid())));

create policy sport_workout_sets_select_own on public.sport_workout_sets for select to authenticated using (exists (select 1 from public.sport_workout_exercises we join public.sport_workout_sessions s on s.id = we.session_id where we.id = workout_exercise_id and s.user_id = (select auth.uid())));
create policy sport_workout_sets_insert_own on public.sport_workout_sets for insert to authenticated with check (exists (select 1 from public.sport_workout_exercises we join public.sport_workout_sessions s on s.id = we.session_id where we.id = workout_exercise_id and s.user_id = (select auth.uid())));
create policy sport_workout_sets_update_own on public.sport_workout_sets for update to authenticated using (exists (select 1 from public.sport_workout_exercises we join public.sport_workout_sessions s on s.id = we.session_id where we.id = workout_exercise_id and s.user_id = (select auth.uid()))) with check (exists (select 1 from public.sport_workout_exercises we join public.sport_workout_sessions s on s.id = we.session_id where we.id = workout_exercise_id and s.user_id = (select auth.uid())));
create policy sport_workout_sets_delete_own on public.sport_workout_sets for delete to authenticated using (exists (select 1 from public.sport_workout_exercises we join public.sport_workout_sessions s on s.id = we.session_id where we.id = workout_exercise_id and s.user_id = (select auth.uid())));