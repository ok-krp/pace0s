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

The connected database reports that the executing `postgres` role is not a member of `supabase_admin` (which is a separate superuser role); the migration therefore does not claim to rewrite that role's independent default ACL entries. Application migrations are expected to execute as `postgres`; this assumption must be checked against the confirmed Vercel target before deployment.

**This is still a draft preflight change.** The configured Vercel project points to the inaccessible `cduyjejftorfuxuwhbqt` ref. No SQL was executed against Supabase, no environment variable was changed, and no Production deployment or merge was performed.
