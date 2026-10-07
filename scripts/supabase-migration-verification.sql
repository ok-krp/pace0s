-- PaceOS migration verification: compact checks only.
select current_database() as database_name, current_setting('server_version') as postgres_version;
select n.nspname schema_name, count(*) table_count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind='r' group by n.nspname order by n.nspname;
select n.nspname,c.relname,c.relrowsecurity rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname;
select count(*) fk_count from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and con.contype='f';
select count(*) index_count from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';
select count(*) trigger_count from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;
select count(*) security_definer_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef;
select pubname,schemaname,tablename from pg_publication_tables where schemaname='public' order by pubname,tablename;
