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

console.log("health E2EE realtime contract: PASS");
