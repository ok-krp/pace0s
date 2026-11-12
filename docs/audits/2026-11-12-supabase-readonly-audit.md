# Supabase read-only audit — 12 November 2026

## Scope and safety

This report compares the two connected PaceOS projects using read-only project inventory, migration history, public-table metadata, Supabase security/performance/health advisors, `pg_policies`, and function metadata/definitions.

No DDL, policy change, data write, migration, deployment, egress-generating data transfer, or Auth setting change was performed. No user-row contents were queried.

## Project comparison

| Item | Older/source project | Current project |
|---|---|---|
| Project ref | `cduyjejftorfuxuwhbqt` | `ohkmiqkhzqekavypiugf` |
| Region | eu-west-1 | eu-west-2 |
| State | ACTIVE_HEALTHY | ACTIVE_HEALTHY |
| Public tables | 45 | 51 |
| Tables with RLS enabled | 45/45 | 51/51 |
| Tables with RLS disabled | 0 | 0 |
| Migration records | 167 | 152 |
| Latest recorded migration | `20261008160927` | `20261112125259` |
| Duplicate migration names observed | 13 | 23 |

The current project contains six public tables not present in the older project: `workspaces`, `workspace_members`, `grocery_lists`, `grocery_list_items`, `pantry_items`, and `nutrition_calibration_feedback`.

The recorded migration histories are not interchangeable. The older project contains import/reconciliation-style version IDs concentrated on 1 October; the current project retains a later migration history through 12 November. Both histories contain repeated migration names with distinct version IDs. Do not copy either migration history over the other or replay migrations against Production without an explicit reconciliation plan.

## RLS policy observations

- Every public table returned by the table inventory has RLS enabled on both projects.
- The inspected `public`-role policies for workspace membership, workspaces, grocery lists/items, pantry items and push subscriptions include `auth.uid()` ownership or membership predicates in `USING` and/or `WITH CHECK`. The inspected policies are not blanket `USING (true)` policies.
- Sensitive service tables such as `ai_provider_secrets`, `ai_tool_idempotency`, `audit_log`, and `billing_events` have explicit client-deny policies in the queried policy set.
- The E2EE pairing-session and legacy-migration-map tables also have client-deny policies; the older project uses restrictive deny policies for these two tables.

- The current project's AI conversation/message policies also contain a special `agent_type = 'coach'` OR a hard-coded email claim exception for the build/admin path. This is an explicit privileged access path; it should be moved to a controlled `app_metadata` role/claim or server-side authorization policy with audited grant/revocation, rather than being embedded as a mailbox string in several RLS policies.
- The `ohk…` multiple-permissive-policy warnings were inspected further. `push_subscriptions` has an authenticated `ALL` owner policy plus four command-specific `public` policies using `auth.uid() = user_id`; `reminder_settings` has an authenticated `ALL` owner policy plus separate SELECT/INSERT/UPDATE/DELETE policies with the same owner predicate. These are redundant policy paths and explain the advisor warning; the queried predicates do not themselves indicate an unowned-row bypass. Consolidation should preserve existing semantics and be tested with owner/non-owner/anon roles.
- The `cduy…` function `insert_coach_ai_food_idempotent_v2` is callable by authenticated, not anon; it checks `p_user_id = auth.uid()` before writing and uses idempotency. However, it remains `SECURITY DEFINER` with `search_path = public`, so it should be pinned to an empty path after its body is changed to fully qualify every object/function reference.

This is a metadata/policy-definition review, not a two-user RLS penetration test. Ownership predicates still need to be exercised with two distinct authenticated test users in an isolated project before sign-off.

## Vercel environment binding

A read-only inventory of the Vercel project environment variables shows that both **Preview** and **Production** currently have `SUPABASE_URL` and `VITE_SUPABASE_URL` set to the older `cduyjejftorfuxuwhbqt` project. The corresponding public publishable-key variables are also present in those scopes. The current `ohkmiqkhzqekavypiugf` project is not the URL currently bound to those Vercel scopes.

This is a P0 environment-target mismatch if `ohk…` is the intended current backend: a Preview build will test against `cduy…`, not `ohk…`. Production is also still configured for `cduy…`. **No Vercel environment variable was changed.** Do not change Production until the intended target, schema lineage and isolated test plan are confirmed. Do not use Production for validation writes.

The latest GitHub Actions preflight is a separate configuration surface: its `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are both missing, so native CI builds are offline/local-only even though Vercel Preview has its own project variables.

## Security advisor findings

### Older/source project `cduy…`

- 10 authenticated-callable `SECURITY DEFINER` routines are flagged by the Supabase advisor. These include the Health E2EE pairing/migration functions, `insert_coach_ai_food_idempotent_v2`, and `upsert_user_state_if_newer`.
- Most inspected functions set an empty search path and the inspected user-state RPC checks `auth.uid() = p_user_id`. The coach-food idempotency function still has `search_path = public`; review its body and ACL before accepting it.
- Leaked Password Protection is disabled.

### Current project `ohk…`

- `public.upsert_user_state_if_newer` is `SECURITY DEFINER`, executable by `authenticated`, checks `auth.uid() = p_user_id`, but still has `search_path = public`. The user check is a positive control; the search path remains a hardening item.
- `public.delete_temporary_workout_after_finish()` is a trigger function and `public.rls_auto_enable()` is an event-trigger function. The advisor flags their default execute ACLs for anon/authenticated. They are trigger/event-trigger entry points rather than ordinary RPC routines, so this alert should not be interpreted as proof that an anonymous REST caller can invoke them as regular functions. Their client execute ACLs should nevertheless be explicitly revoked as defense in depth.
- `public.nutrition_macro_kcal_consistent` is an immutable SQL function with no explicit function search path. Its current body is a pure arithmetic check; the advisor warning is a hardening item, not evidence of data access.
- Leaked Password Protection is disabled.

Remediation references:
- [SECURITY DEFINER callable by anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [SECURITY DEFINER callable by authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Mutable function search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
- [Leaked Password Protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

### Migration and ACL drift confirmed by read-only function inspection

The current `ohk…` migration history ends with these 12 November entries:
- `20261112094030_additive_reconcile_source_schema_20261112`
- `20261112113842_allow_source_food_log_provenance_values_20261112`
- `20261112125259_add_missing_nutrition_reference_read_policies_20261112`

It does **not** contain the proposed `20261111150000_harden_security_definer_routine_acl` migration currently present in the unmerged security-review work. This aligns with the observed live ACL/search-path warnings: the current project's `delete_temporary_workout_after_finish()` and `rls_auto_enable()` still have client execute privileges in their ACL metadata, and `upsert_user_state_if_newer` still has `search_path = public`.

On `cduy…`, the inspected `upsert_user_state_if_newer` already checks `auth.uid() = p_user_id` and uses an empty search path. Most inspected E2EE functions also use an empty search path. The two projects therefore differ in both schema history and routine hardening.

The trigger/event-trigger return types matter: the advisor's execute-ACL warning does not itself prove ordinary PostgREST callers can invoke those routines. Still, least-privilege ACL revocation is warranted and should be verified in a disposable/test database before any Production rollout.

## Performance advisor findings

| Project | Finding | Count / severity | Interpretation |
|---|---|---|---|
| `cduy…` | Unused indexes | 47 / INFO | Review workload and observation window; do not drop automatically |
| `ohk…` | Auth RLS initplan | 53 / WARN | Replace repeated `auth.uid()` evaluation with scalar subselects where semantics are unchanged |
| `ohk…` | Unindexed foreign keys | 13 / INFO | Review FK lookup/delete/update paths and add covering indexes where useful |
| `ohk…` | Multiple permissive policies | 13 / WARN | Review OR-composition and consolidate only after proving policy equivalence |
| `ohk…` | Duplicate indexes | 4 / WARN | Confirm exact column/order/condition equivalence before retaining one |
| `ohk…` | Unused indexes | 74 / INFO | Do not drop without query workload and index-usage history |

No Health advisor notices were returned for either project.

## Prioritized action plan

| Priority | Action | Release condition |
|---|---|---|
| P0 | Reconcile `application`, `main`, the current `ohk…` schema and the older `cduy…` imported history. | One reviewed source-of-truth migration lineage; no blind replay or history rewrite |
| P0 | Configure a dedicated non-production Supabase target and public client key for CI/Preview. | Preflight no longer reports offline/local-only; authenticated tests run only against the isolated target |
| P0 | Execute cross-user RLS tests for `user_state`, Nutrition, AI, Health E2EE, workspace/grocery and push-subscription policies. | User A cannot read/write User B rows; owner/member workspace scenarios pass |
| P1 | Harden the current `upsert_user_state_if_newer` function search path while preserving the `auth.uid() = p_user_id` ownership check. | Function ACL/body/search path verified in isolated DB; RPC tests pass |
| P1 | Revoke client execute grants on trigger/event-trigger-only routines where no client callsite exists. | Trigger-driven behavior still passes; anon/authenticated cannot execute implementation helpers |
| P1 | Review the 10 authenticated-callable definer routines on `cduy…`, especially `insert_coach_ai_food_idempotent_v2`. | Every callable routine has an explicit owner check, fixed search path and least-privilege ACL |
| P1 | Enable Leaked Password Protection after reviewing the intended Auth settings. | Auth configuration verified in the selected target |
| P2 | Tune RLS initplans, foreign-key indexes, duplicate indexes and unused indexes on `ohk…`. | Query plans/workload measurements confirm improvement; no blind index removal |

## Production deployment and runtime incident history

Read-only Vercel deployment inventory shows the latest Production target is still the `main` branch at commit `dd66333ac6228849ca39092beee52a30154fb0a5`, deployed on **2026-10-11 17:03:35 UTC**. Its current aliases include `pace0s.vercel.app`. The active audit/correction branch is a separate Draft PR and has not been promoted; no Production deployment was created.

The last-7-day Vercel runtime-error aggregation returned:
- Two SSR failures affecting two users on route `/__server`, last seen **2026-11-09 20:46:20 UTC**: `TypeError: createServerFn(...).middleware(...).inputValidator is not a function`, followed by an unhandled SSR HTTP 500.
- One server timeout cluster on `/__server`, last seen **2026-11-11 19:42:45 UTC** (300-second runtime timeout).

The most recent Preview build is healthy and its queried Preview runtime log window returned no error/fatal records, but that does not erase the historical Production incidents. The stale Production deployment and the failure history are **P0/P1 release items**: reproduce against the actual current Production build in a safe Preview/isolated environment, prove the fix, then plan a separately approved release. No Production deployment or configuration has been changed.

## CI integration limitation

The latest GitHub Actions Flutter preflight had neither `SUPABASE_URL` nor a public Supabase client key configured. It explicitly selected **offline/local-only** build artifacts. The Web and Flutter CI suites pass, but those results do not establish authenticated cloud synchronization.

The source audit and app code therefore remain validated independently of the live backend. The next cloud-sync verification must use an isolated Supabase target with test accounts; this report does not authorize changes to either connected project.


## Account export and deletion — application correction and remaining target drift

The latest application branch now includes the following code-level hardening:
- Portable export reads the user-owned data allowlist in **500-row pages**, with deterministic primary-key ordering; it also collects sport program items, workout exercises and sets through IDs of the signed-in user's own parent rows.
- Server-only provider secrets, idempotency internals, audit internals, Health E2EE pairing sessions and the legacy migration map are deliberately not placed in the downloadable client export.
- Account deletion explicitly purges the legacy tables that are not all protected by an FK to `auth.users` (including AI conversations/messages/preferences/action logs, development tasks, provider secrets, food logs/scans, health samples, reminders, notifications and user_state). It stops before Auth deletion when a table purge reports an error.
- The request JWT is used to revoke refresh-token sessions globally before deleting account rows. Supabase documents that already-issued access JWTs remain valid until their `exp`; immediate JWT invalidation is not promised.

**Important current-target caveat:** `ohk…` has workspace-related `created_by` foreign keys using `ON DELETE RESTRICT` on grocery lists, grocery items and pantry items. A user who created records in a shared workspace may therefore be unable to delete their Auth user until ownership/creator transfer or a safe shared-data retention policy is designed. The application does not auto-delete shared workspace data. The old Vercel-bound `cduy…` schema has no such workspace tables in its inventory, but the two projects must not be treated as schema-equivalent.

The code changes are validated by TypeScript and pure unit tests only. No account was deleted, no export was run against a live user, and no database writes were performed during this audit.
