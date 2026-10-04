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
