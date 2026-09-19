create or replace function public.sync_sport_user_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  item jsonb;
  program_item jsonb;
  session_ex jsonb;
  set_item jsonb;
  ex_id uuid;
  existing_ex_id uuid;
  prog_id uuid;
  existing_prog_id uuid;
  sess_id uuid;
  we_id uuid;
  v_user uuid := new.user_id;
  v_position integer;
  v_set_number integer;
begin
  if new.key = 'pace.sport.exercises' and jsonb_typeof(new.value) = 'array' then
    for item in select value from jsonb_array_elements(new.value) loop
      ex_id := nullif(item->>'id','')::uuid;
      if ex_id is not null and coalesce(item->>'name','') <> '' then
        select id into existing_ex_id from public.sport_exercises where id=ex_id and user_id=v_user limit 1;
        if existing_ex_id is null then
          select id into existing_ex_id from public.sport_exercises where user_id=v_user and lower(name)=lower(item->>'name') limit 1;
        end if;
        if existing_ex_id is not null then
          update public.sport_exercises
          set name=item->>'name', muscle=coalesce(item->>'muscle','Autre'), equipment=item->>'equipment',
              notes=item->>'notes', default_sets=nullif(item->>'defaultSets','')::int,
              default_reps=nullif(item->>'defaultReps','')::int, default_weight=nullif(item->>'defaultWeight','')::numeric,
              rest_sec=nullif(item->>'restSec','')::int, updated_at=now()
          where id=existing_ex_id and user_id=v_user;
        else
          insert into public.sport_exercises(id,user_id,name,muscle,equipment,notes,default_sets,default_reps,default_weight,rest_sec)
          values(ex_id,v_user,item->>'name',coalesce(item->>'muscle','Autre'),item->>'equipment',item->>'notes',
                 nullif(item->>'defaultSets','')::int,nullif(item->>'defaultReps','')::int,
                 nullif(item->>'defaultWeight','')::numeric,nullif(item->>'restSec','')::int)
          on conflict (user_id,name) do update
            set muscle=excluded.muscle,equipment=excluded.equipment,notes=excluded.notes,
                default_sets=excluded.default_sets,default_reps=excluded.default_reps,
                default_weight=excluded.default_weight,rest_sec=excluded.rest_sec,updated_at=now();
        end if;
      end if;
    end loop;
  elsif new.key = 'pace.sport.programs' and jsonb_typeof(new.value) = 'array' then
    for item in select value from jsonb_array_elements(new.value) loop
      prog_id := nullif(item->>'id','')::uuid;
      if prog_id is not null and coalesce(item->>'name','') <> '' then
        select id into existing_prog_id from public.sport_programs where id=prog_id and user_id=v_user limit 1;
        if existing_prog_id is null then
          select id into existing_prog_id from public.sport_programs where user_id=v_user and lower(name)=lower(item->>'name') limit 1;
        end if;
        if existing_prog_id is not null then
          update public.sport_programs
          set name=item->>'name', emoji=coalesce(item->>'emoji','🏋️'),
              days=coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(item->'days','[]'::jsonb)) x),'{}'::int[]),
              updated_at=now()
          where id=existing_prog_id and user_id=v_user;
        else
          insert into public.sport_programs(id,user_id,name,emoji,days)
          values(prog_id,v_user,item->>'name',coalesce(item->>'emoji','🏋️'),
                 coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(item->'days','[]'::jsonb)) x),'{}'::int[]))
          on conflict (user_id,name) do update set emoji=excluded.emoji,days=excluded.days,updated_at=now();
          select id into existing_prog_id from public.sport_programs where user_id=v_user and lower(name)=lower(item->>'name') limit 1;
        end if;
        if jsonb_typeof(item->'items')='array' then
          v_position := 0;
          for program_item in select value from jsonb_array_elements(item->'items') loop
            ex_id := nullif(program_item->>'exerciseId','')::uuid;
            if ex_id is not null and exists(select 1 from public.sport_exercises where id=ex_id and user_id=v_user) then
              if exists(select 1 from public.sport_program_items where program_id=existing_prog_id and exercise_id=ex_id and position=v_position) then
                update public.sport_program_items
                set sets=coalesce(nullif(program_item->>'sets','')::int,3), reps=coalesce(nullif(program_item->>'reps','')::int,8),
                    weight=nullif(program_item->>'weight','')::numeric, rest_sec=nullif(program_item->>'restSec','')::int, updated_at=now()
                where program_id=existing_prog_id and exercise_id=ex_id and position=v_position;
              else
                insert into public.sport_program_items(program_id,exercise_id,position,sets,reps,weight,rest_sec)
                values(existing_prog_id,ex_id,v_position,coalesce(nullif(program_item->>'sets','')::int,3),
                       coalesce(nullif(program_item->>'reps','')::int,8),nullif(program_item->>'weight','')::numeric,
                       nullif(program_item->>'restSec','')::int);
              end if;
            end if;
            v_position := v_position + 1;
          end loop;
        end if;
      end if;
    end loop;
  elsif new.key = 'pace.sport.sessions' and jsonb_typeof(new.value)='array' then
    for item in select value from jsonb_array_elements(new.value) loop
      sess_id := nullif(item->>'id','')::uuid;
      if sess_id is not null and coalesce(item->>'name','') <> '' then
        insert into public.sport_workout_sessions(id,user_id,program_id,name,workout_date,started_at,ended_at,duration_min,notes,is_temporary)
        values(sess_id,v_user,nullif(item->>'programId','')::uuid,item->>'name',
               coalesce(nullif(item->>'date','')::date,current_date),
               coalesce(to_timestamp(nullif(item->>'startedAt','')::bigint/1000.0),now()),
               case when nullif(item->>'endedAt','') is not null then to_timestamp((item->>'endedAt')::bigint/1000.0) end,
               nullif(item->>'durationMin','')::int,item->>'notes',false)
        on conflict(id) do update set program_id=excluded.program_id,name=excluded.name,workout_date=excluded.workout_date,
          started_at=excluded.started_at,ended_at=excluded.ended_at,duration_min=excluded.duration_min,notes=excluded.notes,is_temporary=false,updated_at=now();

        if jsonb_typeof(item->'exercises')='array' then
          v_position := 0;
          for session_ex in select value from jsonb_array_elements(item->'exercises') loop
            ex_id := nullif(session_ex->>'exerciseId','')::uuid;
            if ex_id is not null and exists(select 1 from public.sport_exercises where id=ex_id and user_id=v_user) then
              select id into we_id from public.sport_workout_exercises where session_id=sess_id and exercise_id=ex_id and position=v_position limit 1;
              if we_id is null then
                insert into public.sport_workout_exercises(session_id,exercise_id,position,note)
                values(sess_id,ex_id,v_position,session_ex->>'note') returning id into we_id;
              else
                update public.sport_workout_exercises set note=session_ex->>'note' where id=we_id;
              end if;
              if jsonb_typeof(session_ex->'sets')='array' then
                v_set_number := 1;
                for set_item in select value from jsonb_array_elements(session_ex->'sets') loop
                  if exists(select 1 from public.sport_workout_sets where workout_exercise_id=we_id and set_number=v_set_number) then
                    update public.sport_workout_sets
                    set reps=greatest(coalesce(nullif(set_item->>'reps','')::int,1),1),
                        weight=greatest(coalesce(nullif(set_item->>'weight','')::numeric,0),0),
                        done=coalesce((set_item->>'done')::boolean,false),updated_at=now()
                    where workout_exercise_id=we_id and set_number=v_set_number;
                  else
                    insert into public.sport_workout_sets(workout_exercise_id,set_number,reps,weight,done)
                    values(we_id,v_set_number,greatest(coalesce(nullif(set_item->>'reps','')::int,1),1),
                           greatest(coalesce(nullif(set_item->>'weight','')::numeric,0),0),coalesce((set_item->>'done')::boolean,false));
                  end if;
                  v_set_number := v_set_number + 1;
                end loop;
              end if;
            end if;
            v_position := v_position + 1;
          end loop;
        end if;
      end if;
    end loop;
  end if;
  return new;
end;
$function$;
