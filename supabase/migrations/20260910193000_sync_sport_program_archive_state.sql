create or replace function public.sync_sport_program_archive_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  prog_id uuid;
  v_user uuid := new.user_id;
begin
  if new.key <> 'pace.sport.programs' or jsonb_typeof(new.value) <> 'array' then
    return new;
  end if;

  for item in select value from jsonb_array_elements(new.value) loop
    prog_id := nullif(item->>'id','')::uuid;
    if prog_id is not null then
      update public.sport_programs
      set is_archived = coalesce((item->>'isArchived')::boolean, false), updated_at = now()
      where id = prog_id and user_id = v_user;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists zz_sport_program_archive_sync on public.user_state;
create trigger zz_sport_program_archive_sync
after insert or update of value on public.user_state
for each row execute function public.sync_sport_program_archive_state();

revoke all on function public.sync_sport_program_archive_state() from public, anon, authenticated;
