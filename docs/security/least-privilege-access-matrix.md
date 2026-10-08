# Supabase least-privilege access matrix

**Target:** Supabase project `cduyjejftorfuxuwhbqt`  
**Branch:** `fix/health-egress-consent-reads`  
**Status:** review artifact only. The migration `20261008150000_least_privilege_client_table_grants.sql` has **not** been applied to Supabase.

## Rules

- `anon`: no direct privileges on `public` tables.
- `authenticated`: only operations actually used by the application, with existing RLS as row-level enforcement.
- No client `TRUNCATE`, `TRIGGER`, or `REFERENCES`.
- Revoke existing table/sequence grants for client roles, then revoke default table, sequence, and function-execute grants for `postgres`. The `supabase_admin` default ACLs cannot be altered by the normal `postgres` migration connection (it is neither superuser nor a member of that role); this remains an explicit pre-apply blocker requiring an authorized elevated session.
- Server/admin-only operations use `supabaseAdmin` or narrowly scoped RPCs; they do not justify client grants.
- RLS policy presence is not equivalent to a grant. A request requires both table privilege and a matching policy.

## Client-role matrix

| Table | Observed operation / caller | Proposed authenticated grant | Existing RLS status | Notes |
|---|---|---|---|---|
| `ai_conversations` | Read/create/update/delete via AI history server functions; some client reads/updates | SELECT, INSERT, UPDATE, DELETE | ALL, owner-scoped | Keep CRUD; child message deletion is by cascade. |
| `ai_messages` | Flutter uses `upsert()` for messages; web/server reads transcript | SELECT, INSERT, UPDATE | ALL, conversation + owner scoped | UPDATE is required by PostgREST upsert semantics; DELETE is not granted. |
| `ai_preferences` | Read and upsert preferences | SELECT, INSERT, UPDATE | ALL, owner-scoped | DELETE not observed. |
| `ai_action_log` | UI reads own log; AI and sport server handlers insert entries | SELECT, INSERT | ALL, owner-scoped | INSERT is required; SELECT is used by history UI. |
| `food_log` | Read, insert, update, delete food entries | SELECT, INSERT, UPDATE, DELETE | CRUD, owner-scoped | All four operations are used. |
| `food_scans` | Read recall history and insert scans | SELECT, INSERT | CRUD, owner-scoped | UPDATE/DELETE not observed; account cleanup uses server admin. |
| `profiles` | Read profile; save through `upsert_profile_if_newer` RPC | SELECT, INSERT, UPDATE | CRUD, owner-scoped | DELETE not observed. Confirm the RPC's invoker/definer privileges before applying. |
| `push_subscriptions` | Read, upsert/register, unregister | SELECT, INSERT, UPDATE, DELETE | ALL, owner-scoped | Upsert requires SELECT + INSERT + UPDATE; unregister requires DELETE. |
| `reminder_settings` | Read and upsert reminder settings | SELECT, INSERT, UPDATE | ALL, owner-scoped | DELETE not observed. |
| `reminder_debug_log` | Authenticated server function reads diagnostics | SELECT | SELECT, owner-scoped | RLS filters rows by `auth.uid() = user_id`; retain no write grant. |
| `development_tasks` | Page reads own tasks; BUILD AI inserts a task | SELECT, INSERT | ALL, owner-scoped | UPDATE/DELETE intentionally withheld from client-facing role. |
| `sport_programs` | Read/create programs; delete newly created program on failed child insert rollback | SELECT, INSERT, DELETE | CRUD, owner-scoped | UPDATE not observed. |
| `sport_program_items` | Insert/remove program items; nested reads through program relation | SELECT, INSERT, DELETE | CRUD, owner-scoped | UPDATE not observed. |
| `sport_progression_targets` | Read and upsert targets | SELECT, INSERT, UPDATE | CRUD, owner-scoped | DELETE not observed. |
| `sport_workout_sessions` | Read/insert sessions; delete a failed partial session during rollback | SELECT, INSERT, DELETE | CRUD, owner-scoped | UPDATE not observed in current direct client paths. |
| `sport_workout_exercises` | Nested reads and inserts while saving sessions | SELECT, INSERT | CRUD, owner-scoped | Child cleanup is performed through parent cascade or server admin. |
| `sport_workout_sets` | Nested reads, inserts and updates to set values | SELECT, INSERT, UPDATE | CRUD, owner-scoped | DELETE in account cleanup uses server admin. |
| `sport_exercises` | Read/create exercises; delete a just-created exercise during rollback | SELECT, INSERT, DELETE | CRUD, owner-scoped | Updates and normal deletion use RPCs. |
| `user_state` | Client reads + Realtime; mutations use `upsert_user_state_if_newer` RPC | SELECT | ALL, owner-scoped | Direct table writes are withheld; verify RPC ACL/body separately. |
| `health_e2ee_devices` | Read/register devices; revocation is through the rotation RPC | SELECT, INSERT | SELECT/INSERT/UPDATE, owner + consent | No direct UPDATE/DELETE observed; RPC owns revocation. |
| `health_e2ee_key_versions` | Flutter reads the current key version | SELECT | SELECT, owner-scoped | SELECT is required for native E2EE key-version lookup. |
| `health_e2ee_key_envelopes` | Read/insert envelopes | SELECT, INSERT | SELECT/INSERT/DELETE, owner + consent | DELETE policy exists but no direct client delete path was found. |
| `health_samples_e2ee` | Read encrypted samples; insert encrypted samples from web and Flutter | SELECT, INSERT | SELECT/INSERT/DELETE, owner + consent on read/insert | Both TS and Flutter upserts changed to ignore duplicates so conflicts are insert-only; DELETE withheld from direct clients. |
| `health_e2ee_recovery_envelopes` | Read and upsert recovery envelope | SELECT, INSERT, UPDATE | CRUD, owner-scoped | DELETE not observed in client code. |
| `consent_records` | Read consent state and insert consent history | SELECT, INSERT | SELECT/INSERT, owner-scoped | UPDATE/DELETE not permitted by current policies. |
| `data_deletion_requests` | Flutter creates a deletion request and returns its new id | SELECT, INSERT | SELECT/INSERT, owner-scoped | UPDATE/DELETE remain server-only; `.insert().select('id')` requires SELECT plus INSERT. |
| `legal_consent` | Read current legal choices and upsert them | SELECT, INSERT, UPDATE | CRUD, owner-scoped | DELETE not observed. |
| `health_samples` | Read legacy rows for migration and delete plaintext only after encrypted verification | SELECT, DELETE | CRUD, owner-scoped | Historical plaintext table; DELETE is needed for the explicit migration path. No INSERT/UPDATE grant. |
| `sport_exercises` | Read catalog + user exercises; insert and rollback-delete exercises | SELECT, INSERT, DELETE | CRUD, owner-scoped | Kept separate from static nutrition catalogs. |
| `billing_subscriptions` | Authenticated billing status reads own subscription | SELECT | SELECT, owner-scoped | Writes are handled by trusted webhook/admin path. |

## No direct grants to `anon` or `authenticated`

The current source inventory shows these as trusted-server or RPC-managed tables, so the migration leaves them without direct client grants:

- `ai_provider_secrets`
- `ai_tool_idempotency`
- `audit_log`
- `billing_events`
- `billing_customers` (billing code uses the admin client)
- `billing_trials` (trial code uses the admin client)
- `health_e2ee_key_versions` is client-readable by Flutter, so SELECT is explicitly granted (not server-only)
- `health_e2ee_pairing_sessions` (pairing is handled through RPCs; target currently has RLS enabled but zero policies)
- `health_legacy_migration_map` (migration RPC/internal mapping)
- `notification_log` (trusted reminder-hook/admin writes)
- `nutrition_canonical_dishes`, `nutrition_data_sources`, `nutrition_dish_references`, `nutrition_reference_dishes`, `nutrition_reference_foods`, `nutrition_reference_sources` (nutrition engine uses the trusted server-side admin client; no direct client table access was found)
- `user_biometrics_e2ee` (no direct source access found in the repository scan)

## Mandatory blockers before applying

1. **Do not apply yet.** The source scan and proposed grant matrix have not passed a full cross-user negative test.
2. `health_e2ee_pairing_sessions` has RLS enabled and zero policies. It must remain inaccessible directly. A branch-only migration now adds current-consent checks to the five pairing mutation RPCs; verify session ownership, expiry, attempt count and caller identity with negative tests before applying.
3. The static review of the 11 Advisor-reported `SECURITY DEFINER` RPCs is documented in [privileged-rpc-review.md](./privileged-rpc-review.md). A cross-user runtime test remains mandatory; the review also records remaining RPC-boundary payload-size validation work.
4. The migration's `REVOKE ALL ON ALL TABLES` is schema-wide. It revokes existing table/sequence grants and `postgres` default table/sequence/function-execute ACLs. The `supabase_admin` default ACLs remain a blocker because the normal migration connection cannot alter them. Before application, reconcile the full table list with all web, Flutter, edge-function, and integration consumers—not just `.from()` hits in the web client.
5. Before any apply, use an authorized `supabase_admin` session to revoke that role's default table/sequence/function-execute ACLs, then run CI, authenticated two-user negative tests (cross-user SELECT/INSERT/UPDATE/DELETE), and a non-production apply; then compare effective grants/policies and run Security Advisor + real multi-device E2E.
6. This migration is prepared on the branch only; no SQL was applied to project `cduyjejftorfuxuwhbqt`.
