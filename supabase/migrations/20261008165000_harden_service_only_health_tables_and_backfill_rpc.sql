-- Harden service-only health tables and maintenance RPC access.
-- These tables are intentionally not client-addressable; privileged RPCs own the workflow.
create policy "health_e2ee_pairing_sessions_deny_anon_authenticated"
on public.health_e2ee_pairing_sessions
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create policy "health_legacy_migration_map_deny_anon_authenticated"
on public.health_legacy_migration_map
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke execute on function public.backfill_health_e2ee_dedupe_hashes(jsonb) from authenticated;
revoke execute on function public.backfill_health_e2ee_dedupe_hashes(jsonb) from anon;
