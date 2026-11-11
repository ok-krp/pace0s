-- Read-only audit of public/private function ACLs and default privileges.
-- Safe to run in SQL Editor or a disposable PostgreSQL database.
-- Do not infer target identity from this query; confirm the project before release.
\set ON_ERROR_STOP on

-- 1) Connection role and PostgREST exposure context.
select
  current_database() as database_name,
  current_user as current_role,
  session_user as session_role,
  current_setting('pgrst.db_schemas', true) as postgrest_exposed_schemas,
  current_setting('pgrst.db_extra_search_path', true) as postgrest_extra_search_path;

-- 2) Effective EXECUTE rights and SECURITY DEFINER surface.
-- PUBLIC is inspected from the explicit function ACL; has_function_privilege
-- reports effective role rights, including inherited PUBLIC permissions.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  pg_get_userbyid(p.proowner) as owner_role,
  case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security_mode,
  p.proconfig as function_settings,
  coalesce(p.proacl::text, acldefault('f', p.proowner)::text) as acl,
  coalesce(acl.public_execute, false) as explicit_public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral (
  select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
  from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
) acl on true
where n.nspname in ('public', 'pace_private')
  and p.prokind in ('f', 'p')
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- 3) Default ACLs by object owner and schema.
-- The postgres and supabase_admin rows must be reviewed separately.
select
  r.rolname as owner_role,
  coalesce(n.nspname, '<global>') as schema_name,
  case d.defaclobjtype
    when 'r' then 'tables'
    when 'S' then 'sequences'
    when 'f' then 'functions'
    when 'T' then 'types'
    when 'n' then 'schemas'
    else d.defaclobjtype::text
  end as object_type,
  d.defaclacl::text as default_acl
from pg_default_acl d
join pg_roles r on r.oid = d.defaclrole
left join pg_namespace n on n.oid = d.defaclnamespace
order by r.rolname, schema_name, object_type;

-- 4) Schema USAGE and RLS inventory for exposed/public objects.
select
  n.nspname as schema_name,
  has_schema_privilege('anon', n.oid, 'USAGE') as anon_schema_usage,
  has_schema_privilege('authenticated', n.oid, 'USAGE') as authenticated_schema_usage,
  has_schema_privilege('anon', n.oid, 'CREATE') as anon_schema_create,
  has_schema_privilege('authenticated', n.oid, 'CREATE') as authenticated_schema_create
from pg_namespace n
where n.nspname in ('public', 'pace_private')
order by n.nspname;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
  has_table_privilege('service_role', c.oid, 'SELECT') as service_role_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;
