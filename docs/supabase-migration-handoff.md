# PaceOS Supabase migration handoff

## Mission state

- Repository: `ok-krp/pace0s`
- Single PR: #292
- Branch: `fix/health-egress-consent-reads`
- HEAD at handoff: `9b37bffc8d6149a1cf71eb976e59acf83e194c98`
- Merge: **forbidden**
- Source project: `jayzswkabxfhzmftagku` / `PaceOS`
- Target project: `oqaqolvjxhrkvscsqhzp` / `PaceOS-Migrated`

## Current Cloud state

Source `PaceOS` is `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.
Target `PaceOS-Migrated` is `INACTIVE`, PostgreSQL 17.11.0.

Attempting to restore the target was rejected by Supabase because the organization is under service restrictions. The target cannot currently accept connections or be verified. **No destructive operation and no source-data mutation was performed.**

The migration therefore remains in the audit/preparation phase until the target becomes accessible.

## Source public inventory observed

All observed public tables have RLS enabled. Current row counts from the live source include:

- profiles 3
- food_log 324
- health_samples 384 (legacy plaintext)
- user_state 225
- ai_conversations 11
- ai_messages 132
- ai_action_log 3797
- consent_records 6
- health_legacy_migration_map 384
- health_samples_e2ee 0
- health_e2ee_devices 0
- health_e2ee_key_envelopes 0
- health_e2ee_recovery_envelopes 0
- health_e2ee_pairing_sessions 0
- plus the nutrition, sport, billing, notification, AI and compliance tables listed by the live schema inventory.

Source has no deployed Supabase Edge Functions.

## Security findings

The source security advisor currently reports:

1. `health_e2ee_pairing_sessions` and `health_legacy_migration_map` have RLS enabled without direct policies. This is currently intentional for privileged/RPC-mediated access and must be preserved only after the RPC ownership checks are verified.
2. Eleven SECURITY DEFINER functions are executable by `authenticated`. This is expected for RPC entry points, but each must enforce authentication and ownership/consent as appropriate.
3. Auth leaked-password protection is disabled. This is recorded as a source configuration finding; it must not be disabled in the migrated environment as a way to hide a regression.

## Health/E2EE contract

`has_current_health_e2ee_consent()` is SECURITY INVOKER and binds both consent checks to `auth.uid()`.

The branch already contains database-boundary hardening for:

- pairing-session/envelope writes;
- `backfill_health_e2ee_dedupe_hashes`;
- `migrate_health_legacy_chunk`;
- `get_pairing_session`;
- `rotate_health_e2ee_key`.

These changes are in migration files and must be applied to the target before Health/E2EE acceptance testing.

## Backup/migration tooling

`scripts/migrate-supabase-local.ps1` already performs source schema/data exports, SHA-256 manifest creation, local reconstruction, and restore without mutating the cloud source.

A target migration must not be considered complete until:
- source backup files are non-empty and hashed;
- target schema/function/RLS/Realtime/Storage/Auth inventories match the expected source contract;
- row counts and key integrity checks match;
- CRUD/RLS/SECURITY DEFINER/Health-E2EE/Realtime/Storage/Auth tests pass;
- multi-device sync is verified on the target;
- rollback artifacts are retained.

## Latest verified audit cycle

- CI run 848 for HEAD `27b12e9d0fb596415f2209c0d972cde22b1c1d80`: **PASS**.
- `test:sync`: PASS.
- `test:health-e2ee-realtime`: PASS.
- build: PASS.
- lint: PASS.
- typecheck: PASS.
- Source currently exposes 23 SECURITY DEFINER functions; 11 are callable by authenticated RPC clients; none are executable by anon.
- Source has 40 public tables in the current inventory. RLS is enabled on all observed tables.
- Realtime publication currently contains `health_samples_e2ee`, `profiles`, and `user_state`.
- Extensions observed: pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.1, uuid-ossp 1.1.
- Index inventory and the complete policy matrix were extracted from the live source.
- The Health E2EE callable definers were checked for authentication and ownership; branch-side consent hardening remains ahead of the live source and is intentionally not applied to the source Cloud during preparation.
- Direct-policy-free tables include `health_e2ee_pairing_sessions` and `health_legacy_migration_map`; these remain intentionally RPC-mediated and require preservation of the privileged ownership checks during migration.

## Cost-controlled migration preflight — 2026-10-04

- Target `oqaqolvjxhrkvscsqhzp` checked once this cycle: **INACTIVE**; PostgreSQL 17.11. No restore retry was issued.
- Source volume was estimated from PostgreSQL statistics, not row downloads:
  - public: ~5,951 estimated rows / 36,298,752 bytes table+index footprint
  - auth: ~661 estimated rows / 1,826,816 bytes table+index footprint
  - storage metadata: ~74 rows / 368,640 bytes database footprint
  - Storage object payload size is not inferable from the observed `storage.objects.metadata->size`; object inventory currently returned 0 rows with a usable size field. No files were downloaded.
- Largest public footprints: `user_state` ~22.0 MB, `ai_messages` ~7.2 MB, `ai_action_log` ~3.7 MB. These are catalog/statistics estimates; they are not an export.
- A compact preflight script and compact post-import verification SQL were added to PR #292:
  - `scripts/supabase-migration-preflight.ps1`
  - `scripts/supabase-migration-verification.sql`
- No data export was started. Existing `scripts/migrate-supabase-local.ps1` remains the eventual explicit export/import mechanism; the current cycle deliberately did not invoke it.
- Supabase's current platform guidance is relevant to the target reconstruction: new public tables may require explicit Data API grants as the rollout reaches all projects on 2026-10-30, while RLS remains a separate authorization layer. citeturn0search2
- Repository dependency audit found the shared client in `src/integrations/supabase/client.ts` still contains a source-project URL and publishable-key fallback. This is a migration-basis issue: production must use environment configuration before target cutover; no production switch was made while the target is inactive.
- `.env.example` already defines `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY`. No secret values were copied into the handoff.
- Current Supabase changelog review found no breaking change requiring modification of the source during this preparation cycle; the notable 2026-07 Realtime schema lock means migration tooling must not attempt to recreate/alter Supabase-managed `realtime` objects directly. citeturn0search0

## SECURITY DEFINER matrix — source live audit

- 23 public SECURITY DEFINER functions were checked in one metadata/function-definition query.
- 11 are executable by `authenticated`; 0 by `anon`.
- All 23 explicitly define a `search_path` setting.
- 12 contain an explicit `auth.uid()` check in the live definition.
- The live source's Health/E2EE pairing RPCs are authenticated-only and contain user-context checks; the branch adds the stricter consent/ownership hardening for the remaining Health/E2EE data RPCs.
- Internal trigger/helper definers such as `handle_new_user`, `prevent_audit_log_mutation`, `prevent_consent_mutation`, `rls_auto_enable`, and timestamp/archive helpers are not client-callable and therefore are not candidates for blanket `REVOKE authenticated` changes.
- No Cloud function definition was modified during this audit cycle.

## Exact next cycle

1. Re-check target service status.
2. If target becomes accessible, inventory target and diff against source.
3. Export/verify source backup before any target write.
4. Reconstruct target schema from migrations.
5. Restore data and managed Auth/Storage data using a verified path.
6. Migrate/verify Realtime, Storage policies, Auth configuration and any functions.
7. Switch application configuration only after target validation.
8. Run full regression and multi-device sync tests.
9. Keep PR #292 open; never merge automatically.
