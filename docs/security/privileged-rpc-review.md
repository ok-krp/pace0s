# Privileged SECURITY DEFINER RPC review

**Target:** Supabase project `cduyjejftorfuxuwhbqt`  
**Branch:** `fix/health-egress-consent-reads`  
**Status:** static source review only. No migration has been applied to the target and no runtime cross-user denial test is claimed.

## Advisor-reported RPC inventory

| RPC | Authentication / ownership | Consent | Search path / ACL | Review result |
|---|---|---|---|---|
| `backfill_health_e2ee_dedupe_hashes(jsonb)` | Requires `auth.uid()`; each updated row is filtered by current user; validates hash and caps batches at 500 | Checks current health/cloud-sync consent | Empty search path; PUBLIC execute revoked; authenticated execute retained | No cross-user row mutation found in source review. Malformed UUIDs fail closed with an exception. |
| `create_pairing_session(uuid,text,text,jsonb,integer)` | Requires auth; initiator device must belong to caller, be active and use ECDH-P256 | Explicit current-consent check in migration `20261008160000` | Empty search path; PUBLIC/anon execute revoked; authenticated execute retained | Ownership and consent checks present. Challenge/public-key size limits should be enforced at the RPC boundary, not only in the application validator. |
| `join_pairing_session(uuid,text,uuid,jsonb)` | Locks caller-owned session; recipient device must belong to caller, be active and differ from initiator | Explicit current-consent check | Empty search path; PUBLIC/anon execute revoked; authenticated execute retained | Expiry, state transitions, failed-attempt counter and lockout are enforced. Secret/public-key input size bounds remain a hardening item. |
| `confirm_pairing_session(uuid,uuid)` | Session and initiator device are scoped to caller; both devices must be active and owned by caller | Explicit current-consent check | Empty search path; PUBLIC/anon execute revoked; authenticated execute retained | No cross-user session confirmation path found in source review. |
| `complete_pairing_session(uuid,uuid)` | Session and recipient device are scoped to caller | Explicit current-consent check | Empty search path; PUBLIC/anon execute revoked; authenticated execute retained | Expiry and state transition are checked. |
| `create_pairing_envelope(uuid,uuid,uuid,text,integer,text)` | Caller-owned session; sender/recipient must match session and both devices must be active and caller-owned | Explicit current-consent check | Empty search path; PUBLIC/anon execute revoked; authenticated execute retained | Algorithm and current key version are checked. Envelope payload size should also be bounded at the RPC boundary. |
| `get_pairing_session(uuid)` | Requires auth; only returns a session owned by caller and in an active state | Explicit current-consent check | Empty search path; PUBLIC execute revoked; authenticated execute retained | Row ownership and state filter present. |
| `insert_coach_ai_food_idempotent_v2(...)` | `p_user_id = auth.uid()`; conversation must belong to caller; existing idempotency result and food log are scoped to caller/conversation/tool | Health consent not applicable to nutrition RPC | Branch migration sets empty search path; PUBLIC/anon execute revoked; authenticated execute retained | Ownership and idempotency boundaries are present. Numeric and text business constraints should also be validated by the RPC if it is treated as an untrusted direct API. |
| `migrate_health_legacy_chunk(jsonb)` | Requires auth; batch is capped at 100; new migration `20261008170000` verifies each legacy row belongs to caller before reserving its UUID | Checks current health/cloud-sync consent | Empty search path; PUBLIC/anon execute revoked; authenticated execute retained | A cross-user map-claim/denial-of-service gap was found in the earlier definition and fixed by the new migration. Runtime negative test still required. |
| `rotate_health_e2ee_key(integer,uuid)` | Requires auth; key version must advance exactly one step; revoked device must belong to caller | Checks current health/cloud-sync consent | Empty search path; PUBLIC execute revoked; authenticated execute retained | Ownership and monotonic key-version checks present. |
| `upsert_user_state_if_newer(uuid,text,jsonb,timestamptz,text)` | Requires `p_user_id = auth.uid()`; rejects empty key and updated_by; timestamp is assigned by server commit time | Not applicable | Later hardening migration sets empty search path; PUBLIC execute revoked; authenticated execute retained | Cross-user write check and server-authoritative timestamp present. `p_updated_by` remains caller-provided metadata, not an authorization input. |

## Cross-cutting observations

- The direct table `health_e2ee_pairing_sessions` has RLS enabled and no direct client policies; pairing goes through narrowly scoped RPCs.
- All 11 Advisor-reported functions were observed as `SECURITY DEFINER` in the live target during the read-only inventory. That inventory is not proof that the branch migrations are deployed.
- The live target's default ACL inventory grants client roles broad privileges for objects created by both `postgres` and `supabase_admin`. The proposed grants migration revokes existing client table/sequence privileges and `postgres` default table/sequence/function-execute privileges, then restores the explicitly enumerated table operations. It cannot revoke `supabase_admin` default ACLs through the normal migration connection because that connection is neither superuser nor a member of `supabase_admin`; an authorized elevated session must handle that before any apply.
- The new legacy-ownership migration and pairing-consent migration have static delimiter/invariant checks in `scripts/test-least-privilege-migration.mjs`; CI must pass on the current HEAD.
- A source review cannot prove runtime RLS denial. Cross-user negative tests and non-production migration application remain mandatory before applying this to the target.

## Explicit remaining blockers

1. Use an authorized `supabase_admin` session to revoke its default table, sequence, and function-execute ACLs for `anon` and `authenticated`; the normal migration connection cannot perform this step.
2. Obtain passing CI results on the current PR HEAD, including Native Flutter's Apple, Android, Linux and Windows jobs.
3. Run authenticated two-user negative tests for SELECT/INSERT/UPDATE/DELETE and RPC ownership/consent rejection in an isolated non-production environment.
4. Apply migrations only in non-production, then compare effective grants, RLS policies, function ACLs and Security Advisor findings.
5. Do not apply these migrations to `cduyjejftorfuxuwhbqt` or merge PR #292 until the above evidence is reviewed.
