begin;

create or replace function public.prevent_immutable_field_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_argv[0] is null then return new; end if;
  if (to_jsonb(new) -> tg_argv[0]) is distinct from (to_jsonb(old) -> tg_argv[0]) then
    raise exception '% is immutable', tg_argv[0];
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_immutable_field_mutation() from public, anon, authenticated, service_role;
grant execute on function public.prevent_immutable_field_mutation() to postgres;

do $$
declare r record;
begin
  for r in
    select c.relname table_name,
           bool_or(a.attname='id') has_id,
           bool_or(a.attname='created_at') has_created_at
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind='r'
      and a.attnum>0 and not a.attisdropped
      and exists (
        select 1 from pg_attribute u
        where u.attrelid=c.oid and u.attname='user_id' and u.attnum>0 and not u.attisdropped
      )
    group by c.relname
  loop
    if r.has_id then
      execute format('drop trigger if exists trg_prevent_id_mutation on public.%I', r.table_name);
      execute format('create trigger trg_prevent_id_mutation before update of id on public.%I for each row execute function public.prevent_immutable_field_mutation(''id'')', r.table_name);
    end if;
    if r.has_created_at then
      execute format('drop trigger if exists trg_prevent_created_at_mutation on public.%I', r.table_name);
      execute format('create trigger trg_prevent_created_at_mutation before update of created_at on public.%I for each row execute function public.prevent_immutable_field_mutation(''created_at'')', r.table_name);
    end if;
  end loop;
end;
$$;

commit;