import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "src/hooks/use-health.tsx"), "utf8");

const channelSetup = source.indexOf("channel = supabase.channel(channelName);");
const callbackRegistration = source.indexOf('channel.on(\n        "postgres_changes"');
const subscribe = source.indexOf("void channel.subscribe();");

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

console.log("health E2EE realtime contract: PASS");
