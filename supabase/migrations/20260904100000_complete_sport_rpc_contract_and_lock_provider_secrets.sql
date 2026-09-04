-- Complete the normalized Sport backend with authenticated, RLS-aware RPC helpers.
-- These functions are security-invoker and always scope mutations to auth.uid().

revoke all on table public.ai_provider_secrets from anon, authenticated;

create or replace function public.sport_update_exercise(
  p_id uuid,
  p_name text default null,
  p_muscle text default null,
  p_equipment text default null,
  p_notes text default null,
  p_default_sets integer default null,
  p_default_reps integer default null,
  p_default_weight numeric default null,
  p_rest_sec integer default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.sport_exercises
  set name = coalesce(p_name, name), muscle = coalesce(p_muscle, muscle), equipment = p_equipment, notes = p_notes,
      default_sets = p_default_sets, default_reps = p_default_reps, default_weight = p_default_weight,
      rest_sec = p_rest_sec, updated_at = now()
  where id = p_id and user_id = (select auth.uid());
  return found;
end;
$$;

create or replace function public.sport_delete_exercise(p_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
begin delete from public.sport_exercises where id = p_id and user_id = (select auth.uid()); return found; end;
$$;

create or replace function public.sport_update_program(p_id uuid, p_name text default null, p_emoji text default null, p_days integer[] default null)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.sport_programs set name=coalesce(p_name,name), emoji=coalesce(p_emoji,emoji), days=coalesce(p_days,days), updated_at=now()
  where id=p_id and user_id=(select auth.uid()); return found;
end;
$$;

create or replace function public.sport_delete_program(p_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
begin delete from public.sport_programs where id=p_id and user_id=(select auth.uid()); return found; end;
$$;

create or replace function public.sport_finish_workout(p_id uuid, p_ended_at timestamptz default now(), p_duration_min integer default null, p_notes text default null)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.sport_workout_sessions set ended_at=p_ended_at, duration_min=p_duration_min, notes=p_notes, updated_at=now()
  where id=p_id and user_id=(select auth.uid()); return found;
end;
$$;

create or replace function public.sport_delete_workout(p_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
begin delete from public.sport_workout_sessions where id=p_id and user_id=(select auth.uid()); return found; end;
$$;

revoke execute on function public.sport_update_exercise(uuid,text,text,text,text,integer,integer,numeric,integer) from public, anon;
revoke execute on function public.sport_delete_exercise(uuid) from public, anon;
revoke execute on function public.sport_update_program(uuid,text,text,integer[]) from public, anon;
revoke execute on function public.sport_delete_program(uuid) from public, anon;
revoke execute on function public.sport_finish_workout(uuid,timestamptz,integer,text) from public, anon;
revoke execute on function public.sport_delete_workout(uuid) from public, anon;
grant execute on function public.sport_update_exercise(uuid,text,text,text,integer,integer,numeric,integer) to authenticated;
grant execute on function public.sport_delete_exercise(uuid) to authenticated;
grant execute on function public.sport_update_program(uuid,text,text,integer[]) to authenticated;
grant execute on function public.sport_delete_program(uuid) to authenticated;
grant execute on function public.sport_finish_workout(uuid,timestamptz,integer,text) to authenticated;
grant execute on function public.sport_delete_workout(uuid) to authenticated;
