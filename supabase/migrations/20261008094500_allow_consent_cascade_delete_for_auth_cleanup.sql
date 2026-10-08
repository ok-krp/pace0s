-- Preserve append-only consent decisions while allowing account deletion cascades.
-- Direct UPDATE/DELETE of a consent record remains forbidden. When auth.users
-- is deleted, PostgreSQL cascades to consent_records after the parent row is gone;
-- permit only that cascade so ephemeral E2E accounts can be cleaned up safely.
create or replace function public.prevent_consent_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1
    from auth.users as u
    where u.id = old.user_id
  ) then
    return old;
  end if;

  raise exception 'consent_records is append-only; record a new decision instead';
end;
$$;
