import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "src/hooks/use-health.tsx"), "utf8");

const channelSetup = source.indexOf("channel = supabase.channel(channelName);");
const callbackRegistration = source.indexOf('channel.on(\n        "postgres_changes"');
const subscribe = source.indexOf("void channel.subscribe((status) =>");

assert.ok(channelSetup >= 0, "health E2EE realtime channel must be created");
assert.ok(callbackRegistration > channelSetup, "health E2EE postgres_changes callback must be registered after channel creation");
assert.ok(subscribe > callbackRegistration, "health E2EE channel must subscribe only after postgres_changes callbacks are registered");

assert.match(source, /supabase\.getChannels\(\)\.find/);
assert.match(source, /await supabase\.removeChannel\(existing\)/);

// Refreshes must not overlap: a realtime/online/local event arriving while a
// full E2EE reconciliation is running must not create concurrent cloud reads.
assert.match(source, /refreshRunningRef/);
assert.match(source, /if \(refreshRunningRef\.current\) return;/);

// Day boundaries must advance by calendar day, not a fixed 24-hour duration;
// fixed durations are wrong across DST transitions.
assert.match(source, /next\.setDate\(next\.getDate\(\) \+ 1\)/);
assert.doesNotMatch(source, /start\.getTime\(\) \+ 24 \* 60 \* 60 \* 1000/);

// The one-time dedupe backfill is bounded to two attempts per browser session;
// repeated health refreshes must not amplify egress after a persistent failure.
assert.match(source, /dedupeBackfillAttemptsKey/);
assert.match(source, /backfillAttempts < 2/);

// The initial reconciliation is bounded to the current calendar day.
assert.match(source, /const \{ start: dayStart, next: dayEnd \} = localDayBounds\(timeZone\)/);
assert.match(source, /limit: 10000/);

// Realtime disconnects must schedule bounded reconnects rather than silently
// leaving the health view stale until a separate online/local event occurs.
assert.match(source, /void channel\.subscribe\(\(status\) =>/);
assert.match(source, /status === "CHANNEL_ERROR"/);
assert.match(source, /status === "TIMED_OUT"/);
assert.match(source, /status === "CLOSED"/);
assert.match(source, /scheduleReconnect/);
assert.match(source, /Math\.min\(30_000/);


const pairingConsentMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261003114000_harden_health_e2ee_pairing_consent.sql"),
  "utf8",
);

assert.match(pairingConsentMigration, /enforce_health_e2ee_pairing_consent/);
assert.match(pairingConsentMigration, /has_current_health_e2ee_consent/);
assert.match(pairingConsentMigration, /security definer/);
assert.match(pairingConsentMigration, /set search_path = ''/);
assert.match(pairingConsentMigration, /before insert or update on public.health_e2ee_pairing_sessions/);
assert.match(pairingConsentMigration, /before insert on public.health_e2ee_key_envelopes/);
assert.match(pairingConsentMigration, /Health E2EE cloud-sync consent is required/);

const privilegedDataRpcMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261003123000_harden_health_e2ee_privileged_data_rpcs.sql"),
  "utf8",
);

assert.match(privilegedDataRpcMigration, /backfill_health_e2ee_dedupe_hashes/);
assert.match(privilegedDataRpcMigration, /migrate_health_legacy_chunk/);
assert.match(privilegedDataRpcMigration, /security definer/);
assert.match(privilegedDataRpcMigration, /set search_path = ''/);
assert.match(privilegedDataRpcMigration, /if not public\.has_current_health_e2ee_consent\(\)/);
assert.match(privilegedDataRpcMigration, /Health E2EE cloud-sync consent is required/);
assert.match(privilegedDataRpcMigration, /where target\.id = row_id/);
assert.match(privilegedDataRpcMigration, /target\.user_id = auth\.uid\(\)/);
assert.match(privilegedDataRpcMigration, /where legacy_sample_id = legacy_id/);
assert.match(privilegedDataRpcMigration, /user_id = auth\.uid\(\)/);

const remainingDefinerMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261004120000_harden_health_e2ee_remaining_definer_rpcs.sql"),
  "utf8",
);

assert.match(remainingDefinerMigration, /create or replace function public\.get_pairing_session/);
assert.match(remainingDefinerMigration, /create or replace function public\.rotate_health_e2ee_key/);
assert.match(remainingDefinerMigration, /security definer/);
assert.match(remainingDefinerMigration, /set search_path = ''/);
assert.match(remainingDefinerMigration, /if auth\.uid\(\) is null/);
assert.match(remainingDefinerMigration, /if not public\.has_current_health_e2ee_consent\(\)/);
assert.match(remainingDefinerMigration, /s\.user_id = auth\.uid\(\)/);
assert.match(remainingDefinerMigration, /where user_id = auth\.uid\(\)/);
assert.match(remainingDefinerMigration, /where id = p_revoked_device_id and user_id = auth\.uid\(\)/);
assert.match(remainingDefinerMigration, /Device does not belong to current user/);

console.log("health E2EE realtime contract: PASS");
