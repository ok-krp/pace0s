create or replace function public.sync_sport_user_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  program_item jsonb;
  session_ex jsonb;
  set_item jsonb;
  ex_id uuid;
  prog_id uuid;
  sess_id uuid;
  we_id uuid;
  v_user uuid := new.user_id;
begin
  if new.key = 'pace.sport.exercises' then
    -- Upsert the complete client state first. Do not blindly delete rows: program
    -- and workout foreign keys may still reference an exercise while state syncs.
    if jsonb_typeof(new.value) = 'array' then
      for item in select value from jsonb_array_elements(new.value) loop
        ex_id := nullif(item->>'id','')::uuid;
        if ex_id is not null and coalesce(item->>'name','') <> '' then
          insert into public.sport_exercises(id,user_id,name,muscle,equipment,notes,default_sets,default_reps,default_weight,rest_sec)
          values(ex_id,v_user,item->>'name',coalesce(item->>'muscle','Autre'),item->>'equipment',item->>'notes',nullif(item->>'defaultSets','')::int,nullif(item->>'defaultReps','')::int,nullif(item->>'defaultWeight','')::numeric,nullif(item->>'restSec','')::int)
          on conflict (id) do update set
            name=excluded.name,
            muscle=excluded.muscle,
            equipment=excluded.equipment,
            notes=excluded.notes,
            default_sets=excluded.default_sets,
            default_reps=excluded.default_reps,
            default_weight=excluded.default_weight,
            rest_sec=excluded.rest_sec,
            updated_at=now();
        end if;
      end loop;
    end if;
    -- Remove only unreferenced exercises that disappeared from client state.
    -- Referenced historical/program rows are retained to keep foreign keys valid.
    delete from public.sport_exercises se
    where se.user_id = v_user
      and not exists (
        select 1 from jsonb_array_elements(coalesce(new.value,'[]'::jsonb)) x
        where nullif(x->>'id','')::uuid = se.id
      )
      and not exists (select 1 from public.sport_program_items pi where pi.exercise_id = se.id)
      and not exists (select 1 from public.sport_workout_exercises we where we.exercise_id = se.id);

  elsif new.key = 'pace.sport.programs' then
    if jsonb_typeof(new.value) = 'array' then
      for item in select value from jsonb_array_elements(new.value) loop
        prog_id := nullif(item->>'id','')::uuid;
        if prog_id is not null and coalesce(item->>'name','') <> '' then
          insert into public.sport_programs(id,user_id,name,emoji,days)
          values(prog_id,v_user,item->>'name',coalesce(item->>'emoji','🏋️'),coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(item->'days','[]'::jsonb)) x), '{}'::int[]))
          on conflict (id) do update set
            name=excluded.name,
            emoji=excluded.emoji,
            days=excluded.days,
            updated_at=now();
        end if;
      end loop;

      delete from public.sport_program_items pi
      using public.sport_programs sp
      where pi.program_id = sp.id
        and sp.user_id = v_user
        and exists (
          select 1 from jsonb_array_elements(new.value) p
          where nullif(p->>'id','')::uuid = sp.id
        );

      for item in select value from jsonb_array_elements(new.value) loop
        prog_id := nullif(item->>'id','')::uuid;
        if prog_id is not null and exists(select 1 from public.sport_programs where id=prog_id and user_id=v_user) and jsonb_typeof(item->'items')='array' then
          for program_item in select value from jsonb_array_elements(item->'items') loop
            ex_id := nullif(program_item->>'exerciseId','')::uuid;
            if ex_id is not null and exists(select 1 from public.sport_exercises where id=ex_id and user_id=v_user) then
              insert into public.sport_program_items(program_id,exercise_id,position,sets,reps,weight,rest_sec)
              values(prog_id,ex_id,(select coalesce(max(position),-1)+1 from public.sport_program_items where program_id=prog_id),coalesce(nullif(program_item->>'sets','')::int,3),coalesce(nullif(program_item->>'reps','')::int,8),nullif(program_item->>'weight','')::numeric,nullif(program_item->>'restSec','')::int);
            end if;
          end loop;
        end if;
      end loop;
    end if;

  elsif new.key = 'pace.sport.sessions' then
    delete from public.sport_workout_sets where workout_exercise_id in (select we.id from public.sport_workout_exercises we join public.sport_workout_sessions s on s.id=we.session_id where s.user_id=v_user);
    delete from public.sport_workout_exercises where session_id in (select id from public.sport_workout_sessions where user_id=v_user);
    delete from public.sport_workout_sessions where user_id=v_user;
    if jsonb_typeof(new.value)='array' then
      for item in select value from jsonb_array_elements(new.value) loop
        sess_id := nullif(item->>'id','')::uuid;
        if sess_id is not null and coalesce(item->>'name','') <> '' then
          insert into public.sport_workout_sessions(id,user_id,program_id,name,workout_date,started_at,ended_at,duration_min,notes)
          values(sess_id,v_user,nullif(item->>'programId','')::uuid,item->>'name',coalesce(nullif(item->>'date','')::date,current_date),coalesce(to_timestamp(nullif(item->>'startedAt','')::bigint/1000.0),now()),case when nullif(item->>'endedAt','') is not null then to_timestamp((item->>'endedAt')::bigint/1000.0) end,nullif(item->>'durationMin','')::int,item->>'notes');
          if jsonb_typeof(item->'exercises')='array' then
            for session_ex in select value from jsonb_array_elements(item->'exercises') loop
              ex_id := nullif(session_ex->>'exerciseId','')::uuid;
              if ex_id is not null and exists(select 1 from public.sport_exercises where id=ex_id and user_id=v_user) then
                insert into public.sport_workout_exercises(session_id,exercise_id,position,note)
                values(sess_id,ex_id,(select coalesce(max(position),-1)+1 from public.sport_workout_exercises where session_id=sess_id),session_ex->>'note') returning id into we_id;
                if jsonb_typeof(session_ex->'sets')='array' then
                  for set_item in select value from jsonb_array_elements(session_ex->'sets') loop
                    insert into public.sport_workout_sets(workout_exercise_id,set_number,reps,weight,done)
                    values(we_id,(select coalesce(max(set_number),0)+1 from public.sport_workout_sets where workout_exercise_id=we_id),coalesce(nullif(set_item->>'reps','')::int,0),coalesce(nullif(set_item->>'weight','')::numeric,0),coalesce((set_item->>'done')::boolean,false));
                  end loop;
                end if;
              end if;
            end loop;
          end if;
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists user_state_sport_sync on public.user_state;
create trigger user_state_sport_sync after insert or update of value on public.user_state for each row execute function public.sync_sport_user_state();