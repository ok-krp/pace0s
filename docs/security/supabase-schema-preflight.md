# PaceOS Supabase schema preflight — 2026-11-10

## Decision

**BLOCKED — do not apply the RLS migration and do not deploy a schema change.**

The application database target cannot currently be tied to a Supabase project visible to the connected Supabase account. The code branch also lacks a large part of the canonical SQL migration history. The RLS proposal in PR #316 is a review artifact only; it is not a complete application schema repair.

## 1. Supabase target identity mismatch

Read-only Vercel environment inspection shows that both Preview and Production use:

- `SUPABASE_URL`: `https://cduyjejftorfuxuwhbqt.supabase.co`
- `VITE_SUPABASE_URL`: `https://cduyjejftorfuxuwhbqt.supabase.co`

The MCP protected-resource metadata served by the latest PR #315 Preview advertises the matching OAuth issuer at `https://cduyjejftorfuxuwhbqt.supabase.co/auth/v1`.

The Supabase connection currently lists only:
- `jayzswkabxfhzmftagku` — PaceOS, INACTIVE
- `oqaqolvjxhrkvscsqhzp` — PaceOS-Migrated, ACTIVE_HEALTHY

The `cduyjejftorfuxuwhbqt` project is not listed and direct project lookup is not authorized by the current Supabase connection. This does **not** prove that the project is deleted; it proves that its current status/schema cannot be verified with the available access. Do not silently substitute either visible project.

## 2. Read-only findings on PaceOS-Migrated

Project inspected: `oqaqolvjxhrkvscsqhzp`.

- 45 public tables.
- RLS disabled on all 45 tables; Supabase Security Advisor marks this critical.
- All 45 tables show zero rows in the current table inventory.
- Zero declared foreign-key constraints in the public schema.
- `list_migrations` returns zero recorded migrations.
- `list_edge_functions` returns zero Edge Functions.
- No public-schema routines were returned by the SQL catalog queries.
- The public tables have API-role grants to `anon` and `authenticated`.

These findings are specific to `PaceOS-Migrated`; they cannot be assumed to describe the Vercel application's configured `cduy...` backend.

## 3. Git migration-history drift

The repository branch comparison at the time of this audit shows:

| Ref | SQL migration files | Supabase RPC types |
|---|---:|---:|
| `main` (`dd66333`) | 184 | 22 functions |
| `application` (`f473c76`) | 16 | 0 functions |
| PR #313 base/head (`acae42e`) | 17 | 1 function |

The GitHub comparison reports that `application` is 259 commits ahead of `main` and 134 commits behind it. The branches have diverged; no merge or mass cherry-pick is safe without a reconciliation plan.

The current application code calls database RPCs including:

- `upsert_profile_if_newer`
- `insert_coach_ai_food_idempotent_v2`
- `rotate_health_e2ee_key`
- `create_pairing_session` and `join_pairing_session`
- `migrate_health_legacy_chunk`
- `backfill_health_e2ee_dedupe_hashes`
- `sport_update_exercise`, `sport_delete_exercise`, and `sport_delete_workout`

Several supporting RPCs are also present in the canonical `main` types/migrations (pairing confirmation/envelope operations, Sport program/workout helpers, and nutrition helpers). The `application` generated Supabase types currently declare no RPC functions. The SQL definitions for the functions above are present in the canonical `main` migration history but are absent from the 16-file `application` migration directory.

## 4. Why PR #316 is not yet executable

The proposed RLS migration addresses row visibility and table privileges, but does not restore the missing functions, storage policies/buckets, triggers, full migration sequence, or schema invariants. Applying it alone could block direct table access while leaving application RPC calls unresolved.

There are also no foreign keys in the inspected `PaceOS-Migrated` schema, so RLS relationship checks do not replace the separate data-integrity work (orphan detection, key/parent consistency and safe FK rollout).

## 5. Required remediation sequence

1. Confirm the authoritative Supabase project for Vercel Preview and Production. Verify its URL/ref, database schema, migration history, auth configuration, storage buckets, Edge Functions and current data inventory.
2. Restore/reconcile the canonical migration history against the actual target. Do not merge the 134-commit divergent `main` history into `application` without reviewing conflicts and migration ordering.
3. Reconcile generated Supabase types with the actual schema and the RPC functions invoked by current web/Flutter code.
4. Validate function ownership, `SECURITY INVOKER/DEFINER`, pinned `search_path`, execution grants and caller identity checks.
5. Build disposable/local PostgreSQL tests for the complete migration chain and RLS policies, including two-user isolation, anonymous denial, CRUD, E2EE and Sport relationship paths.
6. Apply only after explicit target confirmation, backup/data inventory, reviewed migration plan and approval.

## Safety status

No Supabase migration was applied, no branch/project was created, no production data was modified, no Vercel environment variable or DNS record was changed, and no paid resource was created.

## 6. Follow-up ACL review — 2026-11-11

A read-only catalog query on the connected `PaceOS-Migrated` project confirmed that the `postgres` owner has schema-level default ACL entries granting `EXECUTE` on future public functions to `anon` and `authenticated`. PostgreSQL also grants function execution to `PUBLIC` by default. The original review migration closed default table and sequence grants but did not close these function defaults.

The PR #316 review migration has now been amended to:

- revoke the global default `EXECUTE` privilege from `PUBLIC` for functions created by the migration role;
- revoke the `anon` and `authenticated` default `EXECUTE` grants for new functions in `public`;
- keep the app-called `public.has_current_health_e2ee_consent()` RPC available only to `authenticated`;
- move the policy-only `SECURITY DEFINER` ownership helper into `pace_private`, outside the standard exposed `public` API schema;
- add PostgreSQL integration assertions proving the defaults are closed and the two helpers retain only their intended authenticated execution path.



Before applying the revised migration, inspect the confirmed project's Data API configuration (Project Settings → API → Exposed schemas) and verify that `pace_private` is **not** exposed. The connected audit project returned no existing `pace_private` schema, but the configured `cduy...` project is inaccessible to this connection, so its API exposure configuration has not been verified. If the helper schema is exposed, this must be corrected before the helper can be considered private.
The connected database reports that the executing `postgres` role is not a member of `supabase_admin` (which is a separate superuser role); the migration therefore does not claim to rewrite that role's independent default ACL entries. Application migrations are expected to execute as `postgres`; this assumption must be checked against the confirmed Vercel target before deployment.

**This is still a draft preflight change.** The configured Vercel project points to the inaccessible `cduyjejftorfuxuwhbqt` ref. No SQL was executed against Supabase, no environment variable was changed, and no Production deployment or merge was performed.


## 7. Bidirectional tenant-isolation regression checks — 2026-11-11

The disposable PostgreSQL assertion suite now explicitly models two separate authenticated SQL transactions:

- User A can read only A's profile and cannot change its `user_id` to B.
- User B can read only B's profile and cannot read A's profile; B also cannot reassign ownership to A.
- The anonymous role cannot SELECT the private profiles table.
- Existing checks for cross-user inserts, billing immutability, parent-child Sport relationships, E2EE consent, and server-only tables remain in the suite.

The assertions and static coverage guard were updated on the PR #316 branch. The workflow run for the latest code head is the release signal; do not mark these new tests passed until that exact run completes successfully.


## 8. Supabase project-reference drift across Git and Vercel — 2026-11-11

A direct read of the tracked `supabase/config.toml` files and the non-decrypted Vercel environment inventory found three different project refs:

| Source | Configured project ref |
|---|---|
| Git `main` `supabase/config.toml` | `jayzswkabxfhzmftagku` |
| Git `application` `supabase/config.toml` | `vqpnhqxrsmcyalotiypk` |
| PR #316 branch `supabase/config.toml` | `vqpnhqxrsmcyalotiypk` |
| Vercel Preview `SUPABASE_URL` + `VITE_SUPABASE_URL` | `cduyjejftorfuxuwhbqt` |
| Vercel Production `SUPABASE_URL` + `VITE_SUPABASE_URL` | `cduyjejftorfuxuwhbqt` |

The connected Supabase account lists only `jayzswkabxfhzmftagku` (inactive) and `oqaqolvjxhrkvscsqhzp` (active `PaceOS-Migrated`). Neither `vqpnhqxrsmcyalotiypk` nor `cduyjejftorfuxuwhbqt` appears in that list; direct lookup of those refs is denied by the current Supabase connection. This is an access/identity gap, not proof that either project has been deleted.

The CLI migration target (`vqp...`) and Vercel runtime target (`cduy...`) are therefore not aligned. Do not run `supabase link`, `db push`, migration repair, or OAuth setup against a guessed ref. Confirm the authoritative project and align the tracked CLI config and Vercel Preview/Production URLs deliberately, with the environment targets kept separate and reviewed.


## 9. Canonical RPC/type parity review — 2026-11-11

The generated Supabase database types were compared directly across the three branches:

| Branch | Generated public `Functions` declarations |
|---|---:|
| `main` | 22 |
| `application` | 0 |
| PR #316 (after the review migration/type update) | 2 |

The PR #316 branch contains the SQL for `upsert_user_state_if_newer` and now adds `has_current_health_e2ee_consent()`; its policy-only pairing predicate lives in `pace_private` and is deliberately not part of the exposed public database types. The generated types and static coverage test were updated to reflect that public/private boundary.

Twenty public RPC declarations present in `main` are still absent from PR #316's generated type contract and from its current application migration chain:

- Nutrition: `canonicalize_nutrition_meal`, `nutrition_macro_kcal_consistent`, `insert_coach_ai_food_idempotent`, `insert_coach_ai_food_idempotent_v2`.
- Profile: `upsert_profile_if_newer`.
- Sport: `sport_update_exercise`, `sport_delete_exercise`, `sport_update_program`, `sport_delete_program`, `sport_finish_workout`, `sport_delete_workout`.
- Health/E2EE: `rotate_health_e2ee_key`, `migrate_health_legacy_chunk`, `backfill_health_e2ee_dedupe_hashes`, `create_pairing_session`, `join_pairing_session`, `confirm_pairing_session`, `complete_pairing_session`, `create_pairing_envelope`, `get_pairing_session`.

The v2 Nutrition function is a separate source-of-truth defect: a repository-wide code search finds `insert_coach_ai_food_idempotent_v2` in the main application callsite and generated types, but not in a SQL migration. The checked-in canonical v1 migration `20260903100855_add_ai_food_tool_idempotency.sql` defines only `insert_coach_ai_food_idempotent` and has no `p_meta` argument. Migration files `20260913193556_add_coach_ai_food_idempotent_v2_meta.sql` and `20260913193605_fix_coach_ai_food_idempotent_v2_sodium.sql` are no-op compatibility markers, not function definitions. Do not substitute v1 for v2 or create a guessed replacement; recover the authoritative v2 SQL from the confirmed source database/change history, then add a reviewed canonical migration and tests.

Some older migration filenames on `main` are also no-op compatibility markers whose SQL is represented by later canonical migrations. Migration recovery must use the actual SQL definitions and dependency order, not replay every filename or assume each historical marker contains its named change.

**Release blocker remains:** no schema/RPC migration chain is complete for the intended target. The isolated RLS preflight is intentionally not a schema-restoration migration.


## 10. Historical provenance of the missing Nutrition v2 SQL — 2026-11-11

The missing v2 definition was traced to merged PR [#178](https://github.com/ok-krp/pace0s/pull/178), merged on 2026-09-13. Its description states that `insert_coach_ai_food_idempotent_v2` was added in Supabase and that its function definition was verified. The PR patch itself changes only `src/components/AppSidebar.tsx`, `src/components/MobileNavSettings.tsx` and `src/lib/ai-chat.server.ts`; it contains no SQL migration.

At both PR #178's base commit (`5e6f61d`) and merge commit (`706febd`), `supabase/config.toml` pointed to `jayzswkabxfhzmftagku`. That inactive project is therefore the strongest historical candidate for the remote application of the v2 function, but this is not conclusive proof that the RPC still exists there or was never copied elsewhere.

The connected Supabase migration-history read for the inactive `jayz...` project timed out. No project restart was attempted. The only safe recovery paths are an authorized SQL/schema export, a verified backup, or a reachable authoritative database snapshot. The v2 definition must then be committed as a canonical migration with tests for atomic `food_log.meta` persistence, replay idempotency, ownership checks and grants.


## 11. Historical no-op migration inventory — 2026-11-11

A repository code search on `main` returned 84 migration files containing compatibility/history-marker language. Of those results, 66 explicitly state that the remote migration version is already recorded and that the checked-in file is a no-op marker. Examples include:

- `20260913193556_add_coach_ai_food_idempotent_v2_meta.sql`
- `20260904085504_complete_sport_rpc_contract_and_lock_provider_secrets.sql`
- `20260922182501_health_e2ee_device_pairing_v1.sql`
- `20260903100937_add_ai_food_tool_idempotency.sql`
- `20260918104801_billing_foundation.sql`
- `20260929125532_harden_cloud_sync_rpc_search_path.sql`

Other marker files say that their schema changes are represented by later canonical migrations. Search-result snippets also include at least one file with real DDL (`20260825180000_v4_backend_reconciliation.sql`), so the 84 search hits must not be treated as 84 no-op files. Each migration must be opened and classified by its effective SQL and dependency order.

The replay inventory must distinguish:
1. canonical SQL migrations that actually create/alter schema or functions;
2. remote-history compatibility markers with no SQL;
3. historical placeholders whose real implementation lives in a later canonical migration;
4. migrations applied directly to remote projects whose SQL was never committed (the Nutrition v2 case above).

Do not run the 184-file `main` directory as a fresh linear migration chain or use `migration repair` to paper over these categories without a target-specific plan.


## 12. Explicit migration-owner ACLs and routine audit — 2026-11-11

The proposed migration now scopes all default-privilege hardening explicitly to `FOR ROLE postgres`. This avoids silently changing the defaults for whichever role happens to run the migration in another environment. The disposable CI fixture connects as `postgres`, matching this assumption.

Added `scripts/rls-postgres-function-acl-audit.sql`, a read-only target preflight that reports:

- current database/session role and the available PostgREST exposed-schema settings;
- each `public` / `pace_private` routine, owner, identity arguments, result, `SECURITY DEFINER` / `INVOKER`, function settings, explicit `PUBLIC EXECUTE`, and effective `anon`, `authenticated`, and `service_role` execution rights;
- default ACL entries grouped by object owner and schema, so `postgres` and `supabase_admin` are reviewed separately;
- schema USAGE and public-table RLS/SELECT privileges.

The PostgreSQL CI preflight now runs this inventory after the isolation assertions. Its static coverage test verifies that the audit script remains read-only. This does **not** revoke EXECUTE from existing functions: the target's routines must first be inventoried and classified against the canonical RPC list, then each function must receive an explicit intended grant/revoke decision. The current visible audit project has zero public routines, which cannot substitute for the inaccessible runtime target.


## 13. Privileged routine source review — 2026-11-11

Review of tracked `main` migration definitions and later SQL markers identified the following routines for target-side verification:

| Routine | Source definition / security posture | Current review |
|---|---|---|
| `rotate_health_e2ee_key(integer, uuid)` | `SECURITY DEFINER`, `SET search_path = public`; owner check via `auth.uid()`; explicit grant to authenticated after revoking PUBLIC | Replace with a fully-qualified body and empty `search_path` in a canonical follow-up migration before rollout. |
| `sync_sport_user_state()` | `SECURITY DEFINER`, `SET search_path = public`; trigger-only; explicit revoke from PUBLIC/anon/authenticated in a prior migration that later `CREATE OR REPLACE` operations preserve | Confirm runtime ACL remains revoked and assess search-path hardening. |
| `delete_temporary_workout_after_finish()` | `SECURITY DEFINER`, `SET search_path = public`; trigger-only; the tracked canonical definition has no explicit EXECUTE revoke. A later lock-down filename exists only as a no-op history marker. | Missing canonical privilege change; verify target ACL and add a real canonical follow-up. |
| `sync_sport_program_archive_state()` | `SECURITY DEFINER`, empty `search_path`; explicit revoke from PUBLIC/anon/authenticated | Reviewed as trigger-only. |
| `enforce_daily_nutrition_chat()` | `SECURITY DEFINER`, empty `search_path`; explicit revoke from PUBLIC/anon/authenticated | Reviewed as trigger-only. |
| `prevent_audit_log_mutation()`, `prevent_consent_mutation()`, `set_deletion_request_updated_at()` | Trigger-only definer functions; explicit revokes, but configured with `search_path = public, pg_temp` | Confirm target ACL and assess whether the path can be reduced to an empty path. |
| `delete_user_data(uuid)` | `SECURITY DEFINER`, `search_path = public, pg_temp`; revokes EXECUTE from PUBLIC/anon/authenticated; no tracked application callsite found | Treat as dormant until its intended server caller and explicit service-role grant are established; do not grant it speculatively. |

The new read-only audit script now reports whether `anon` or `authenticated` can `CREATE` in `public` or `pace_private`, in addition to function `proconfig`, owner and effective EXECUTE ACLs. This is necessary to quantify the risk of a mutable `search_path = public`; the connected project did not respond to the read-only SQL request, so no current ACL conclusion is claimed.

Do not infer effective target ACLs from source migrations alone. The target audit must be executed against the positively confirmed runtime project and every result compared to the canonical RPC/trigger inventory.


### Default ACL nuance added after review

The function default-privilege hardening now revokes `EXECUTE` from `PUBLIC` both globally for `postgres` and specifically in schema `public`. Per-schema default ACL entries are additive to global defaults; a pre-existing schema-scoped PUBLIC grant must not survive a global revoke. The PostgreSQL integration test inspects `aclexplode(proacl)` for the new probe function and fails if a direct PUBLIC EXECUTE entry is present, in addition to checking effective `anon` and `authenticated` execution.


### E2EE device revocation is now RPC-only

The RLS proposal no longer grants `UPDATE` on `health_e2ee_devices` to `authenticated`, and removes the direct update policy. The tracked app rotates keys and revokes a device through `rotate_health_e2ee_key(p_new_key_version, p_revoked_device_id)`; no direct table-update callsite was found in the web or Flutter implementations. PostgreSQL assertions now fail if the role has table UPDATE or attempts to set a revoked device's `revoked_at` back to NULL. The privileged rotation RPC remains separately subject to the target routine ACL/search-path audit.


### Cloud synchronization is now RPC-write-only

The RLS proposal removes `user_state` from the generic owner CRUD loop. Authenticated users retain owner-scoped `SELECT`, but do not receive table `INSERT`, `UPDATE` or `DELETE`; all mutations must use `upsert_user_state_if_newer`, whose database-side timestamp comparison prevents stale-device writes from replacing newer state. The PostgreSQL fixture seeds one row per test account and tests all three direct-write denials. Static coverage also requires the generated public RPC type to remain present.


### Recovery-envelope policy gap closed

The historical `health_e2ee_recovery_envelopes` table was previously included in the generic owner CRUD loop. The app uses it only for an authenticated owner-scoped SELECT and UPSERT; account deletion is performed server-side with the service role. The proposal now moves it into the E2EE access class: SELECT/INSERT/UPDATE require both current granular consents, ownership is checked on all three operations, and direct authenticated DELETE is removed. The PostgreSQL fixture now matches the actual recovery-envelope table shape and tests no-consent denial, owner write/read, cross-account denial and access denial after consent withdrawal.

The public consent helper now uses an empty `search_path` with fully-qualified table references. The private `pace_private` schema also receives explicit default-function EXECUTE revocations for `postgres`, including schema-level `PUBLIC`, `anon` and `authenticated` entries.


## 14. Pairing-envelope nonce schema contradiction — 2026-11-11

The canonical E2EE device/envelope table migration declares `health_e2ee_key_envelopes.nonce NOT NULL`. However, the tracked `create_pairing_envelope(...)` SECURITY DEFINER RPC inserts `NULL` for the `ECDH-P256/HKDF-SHA256/AES-256-KW` algorithm, and the Flutter direct insert path also sends `nonce: null` for AES Key Wrap key bundles. AES-GCM envelopes still require a nonce. No tracked migration previously changed this nullability.

Added canonical migration `20261111140000_allow_nullable_health_e2ee_envelope_nonce.sql` to drop the NOT NULL constraint while documenting that NULL is valid only for key-wrap formats at the application contract level. The disposable PostgreSQL 16 fixture now starts with the historical NOT NULL constraint, applies the RLS proposal, then applies this repair. Its assertions insert both an AES-GCM envelope with a nonce and an AES Key Wrap envelope with a NULL nonce. This migration remains unmerged and unexecuted against Supabase.


## 15. Generated Supabase table-type drift — 2026-11-11

The generated `src/integrations/supabase/types.ts` files were counted by parsing the actual `Tables` and `Functions` sections on each branch:

| Branch | Table definitions | Function/RPC definitions |
|---|---:|---:|
| `main` | 45 | 22 |
| `application` | 14 | 0 |
| Current PR #316 | 15 | 2 |

Therefore 31 of the 45 audited public tables are not represented in the current PR branch's generated TypeScript contract, and 20 of the 22 `main` RPC definitions are absent. The PR currently includes only the consent helper and `upsert_user_state_if_newer` in its function section. Many code paths consequently cast Supabase clients to `any`, hiding schema mismatches from TypeScript.

Do not blindly copy `main`'s generated types into `application`: the 22-function contract includes the Nutrition v2 RPC whose SQL body is missing from all tracked migrations, as well as other functions absent from the application's 16-migration chain. Regenerate the client types only after the target database schema and complete canonical migration chain have been recovered, replayed in an isolated clone, and reconciled to the actual app contract.

## 16. Privacy export and deletion coverage expanded

The current PR branch's prior `privacy.functions.ts` exported/deleted only a small nine-table owner list. It now has separate explicit allowlists: a direct authenticated/RLS export list and a broader service-role deletion list. The export covers owner-readable E2EE recovery material, key versions, encrypted biometrics, AI data, billing, consent and Sport; relationship-only Sport child rows are fetched through owner-filtered parent IDs under RLS. RPC-only pairing sessions and migration maps are not exposed through the direct export API. The deletion flow removes child sets/exercises/program items before their parents and deletes owned E2EE/service tables by `context.userId`; it refuses to delete the Auth user if any cleanup fails. Provider secrets and idempotency state are deleted but are never included in user exports.

The export deliberately uses the authenticated Supabase client, not `service_role`, so row and parent-ownership RLS remains active. The account deletion flow uses the service client only on a server-side fixed allowlist and always applies the authenticated user's ID; user-provided IDs are not accepted.
