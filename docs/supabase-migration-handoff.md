# PaceOS Supabase migration handoff

## Mission state

- Repository: `ok-krp/pace0s`
- Single PR: #292
- Branch: `fix/health-egress-consent-reads`
- Merge: **forbidden**
- Source project: `jayzswkabxfhzmftagku`
- Active target project: `cduyjejftorfuxuwhbqt` / **PaceOS**
- Target region: `eu-west-1` / West EU (Ireland)
- Target URL: `https://cduyjejftorfuxuwhbqt.supabase.co`

## Current Cloud state

The target is now active and reachable. The migration is in the verification/hardening phase; the production application has **not** been cut over.

No source data was deleted or mutated.

## Verified target parity

Compact source/target verification currently shows:

- public tables: **45 / 45**
- public row-count differences: **0**
- primary keys: **45 / 45**
- foreign keys: **39 / 39**
- UNIQUE constraints: **15 / 15**
- CHECK constraints: **77 / 77**
- indexes: **126 / 126**
- policies: **93 / 93**
- all 45 public tables have RLS enabled
- index and constraint hashes match
- policy hash matches
- `auth.users`: 3 / 3
- `auth.identities`: 3 / 3
- `storage.buckets`: 1 / 1
- `storage.objects`: 0 / 0
- Realtime publication entries match for `health_samples_e2ee`, `profiles`, and `user_state`

Transient target auth sessions/tokens were intentionally not copied.

## Target corrections already applied

- Removed target-only `public.food_log.source DEFAULT 'manual'`.
- Removed target-only `NOT NULL` from `public.health_e2ee_key_envelopes.nonce`.
- Removed target-only direct SELECT policies from `health_e2ee_pairing_sessions` and `health_legacy_migration_map`; these remain RPC-mediated.
- Revoked anonymous EXECUTE on `public.has_current_health_e2ee_consent()`.

## Health/E2EE database-boundary hardening applied to target

The target now contains the branch hardening for all identified privileged Health/E2EE paths:

- `enforce_health_e2ee_pairing_consent()`
- `health_e2ee_pairing_consent_guard`
- `health_e2ee_pairing_envelope_consent_guard`
- `backfill_health_e2ee_dedupe_hashes(jsonb)`
- `migrate_health_legacy_chunk(jsonb)`
- `get_pairing_session(uuid)`
- `rotate_health_e2ee_key(integer, uuid)`

The pairing trigger function is SECURITY DEFINER with an empty `search_path`, requires `auth.uid()`, and requires current Health E2EE/cloud-sync consent. Its EXECUTE ACL is locked to the database owner; it is not exposed to `anon` or `authenticated`.

The four privileged maintenance/read/key-rotation RPCs now explicitly require both authentication and `has_current_health_e2ee_consent()`, while retaining user ownership predicates.

Pairing create/join/confirm/complete/envelope RPCs remain ownership-bound and are protected at the table boundary by the consent triggers.

## Health/E2EE RLS audit

Source and target policy semantics match for:

- `health_e2ee_devices`
- `health_e2ee_key_envelopes`
- `health_e2ee_key_versions`
- `health_e2ee_recovery_envelopes`
- `health_samples_e2ee`

The device/envelope/sample access paths bind rows to `auth.uid()`; device/envelope/sample cloud-sync operations additionally require current Health E2EE consent.

`health_e2ee_pairing_sessions` and `health_legacy_migration_map` intentionally have RLS enabled without direct client policies and are accessed through ownership-checked privileged RPCs.

## Current security-advisor state

Target security advisor no longer reports an anonymous SECURITY DEFINER finding for the pairing trigger.

Remaining findings are:

- 2 INFO: RLS enabled without direct policies on the intentionally RPC-mediated pairing/legacy-map tables.
- 11 WARN: authenticated-callable SECURITY DEFINER RPCs. These are intentional RPC entry points and are being audited function-by-function rather than blanket-revoked.
- 1 WARN: leaked-password protection disabled. This remains a recorded readiness item and is **not** enabled during this migration cycle.

## Function inventory

Current target counts now match source:

- public functions: **38 / 38**
- SECURITY DEFINER functions: **23 / 23**
- public triggers: **19 / 19** (non-internal public triggers)

The previously missing target function `enforce_health_e2ee_pairing_consent()` and its two consent triggers are now present.

## Cost-controlled migration constraints

- No repeated full export was performed after parity was established.
- No large `SELECT *` export was used for verification.
- Storage payloads were not downloaded because `storage.objects` is empty.
- Source data remains untouched.
- Verification uses compact metadata, hashes, counts and targeted definitions.

## Cutover gate

Production configuration must remain on the source until all of the following are green:

1. target function/trigger/RLS/constraint/index/policy parity;
2. Auth fresh sign-in/session creation against target;
3. Health/E2EE regression including consent-denied and consent-granted paths;
4. Realtime verification;
5. Storage verification;
6. CRUD and sync regression;
7. multi-device sync test;
8. CI/build/lint/typecheck;
9. only then environment cutover to `https://cduyjejftorfuxuwhbqt.supabase.co`.

Never expose a service-role/secret key in the browser.

## Repository / PR policy

- PR #292 only.
- **Never merge automatically.**
- Do not create a second migration PR for this work.
- Continue fixing/verifying within #292 until the acceptance gate is satisfied.

## Latest repository/deployment verification — 2026-10-04

- Latest verified repository commit: `7d2b4e64d7cf36ee0cf9459f7a7e059c54cc6292`.
- Supabase target migrations applied for schema parity:
  - `20261004135850_remove_target_only_compatibility_columns_20261004`
  - `20261004140134_align_profiles_column_semantics_20261004`
- Target public columns now match source: **452 / 452**.
- Column semantic hash (type/nullability/default, order-independent) now matches source.
- Vercel preview for the latest verified commit: **READY**.
- Vercel GitHub status: **success**.
- Runtime errors: **0** in the last hour.
- Production was not promoted; this remains a preview/cutover-gate validation.

## Schema-drift resolution

The previously identified 3-column target-only delta has been resolved.

The columns were target-only, absent from the source schema and absent from the generated application database types. Before removal, all 23 affected target rows had non-null timestamps, but the values were target-generated on 2026-10-01 and were not part of the canonical source schema.

They were removed through the target migration:

`20261004135850_remove_target_only_compatibility_columns_20261004`

The source database was not modified. The target now reports the same total public column count as source (**452**), and the three column names are absent from the target.

A follow-up semantic drift was then found in `profiles`: target had a default on `id` and `NOT NULL` on `training_sessions_goal` that source did not. Both were corrected; the order-independent column semantic hash is now identical.

## Final structural verification — 2026-10-04

- Public column inventory: **452 / 452**.
- Public table RLS state hash: **identical**; 45 / 45 tables have RLS and 0 / 0 have FORCE RLS.
- Policies: **93 / 93**, policy hash **e3bbd77fd46c8d36fdd075b93c07fee0** on both projects.
- Indexes: **126 / 126**, index hash **5caf0903c25518a2d86c32f0c4092115** on both projects.
- Constraints: **176 / 176**, constraint-definition hash **ad19418e4d1461e2c9135e94f2525c5f** on both projects.
- Public functions: **38 / 38**; SECURITY DEFINER: **23 / 23**.
- Public triggers: **19 / 19**, with identical trigger inventory and definitions.
- Function-definition inventory differs only in the four intentionally hardened Health/E2EE functions: backfill_health_e2ee_dedupe_hashes, get_pairing_session, migrate_health_legacy_chunk, rotate_health_e2ee_key. The target versions add authentication/consent/ownership hardening and are intentionally retained; source remains untouched.
- SECURITY DEFINER execution ACL surface matches: 0 anonymous-executable SECURITY DEFINER functions; 11 authenticated-callable intentional RPC entry points.
- Profiles: 3 / 3 rows.
- Nutrition reference foods: 20 / 20 rows.
- User state: 225 / 225 rows.
- Health E2EE devices: 0 / 0 rows.
- Vercel latest verified deployment: **READY**; GitHub status **success**; runtime errors **0** in the last hour.

## Remaining cutover blockers

The database structural migration is no longer blocked by schema/constraint/index/policy/trigger parity. Remaining acceptance gates are functional rather than structural:

1. fresh Auth sign-in/session creation against target;
2. Health/E2EE consent-denied and consent-granted regression;
3. Realtime verification;
4. Storage verification;
5. CRUD + cloud-sync regression;
6. real multi-device sync test;
7. CI build/lint/typecheck on the final code state;
8. only then switch application runtime configuration from source to target.

Leaked-password protection remains disabled by explicit migration policy and is not a cutover blocker unless separately required by product policy.
