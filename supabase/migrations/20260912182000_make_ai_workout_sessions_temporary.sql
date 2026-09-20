alter table public.sport_workout_sessions
  add column if not exists is_temporary boolean not null default true;

create or replace function public.delete_temporary_workout_after_finish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_temporary and new.ended_at is not null then
    delete from public.sport_workout_sessions where id = new.id;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists sport_workout_sessions_delete_temporary_after_finish on public.sport_workout_sessions;
create trigger sport_workout_sessions_delete_temporary_after_finish
after update of ended_at on public.sport_workout_sessions
for each row
when (new.ended_at is not null and new.is_temporary = true)
execute function public.delete_temporary_workout_after_finish();
