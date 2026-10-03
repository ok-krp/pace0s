import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "https://cduyjejftorfuxuwhbqt.supabase.co";
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;

if (!key || !email || !password) {
  throw new Error("Missing SUPABASE_PUBLISHABLE_KEY, E2E_TEST_EMAIL or E2E_TEST_PASSWORD.");
}

const makeClient = () => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const a = makeClient();
const b = makeClient();

async function signIn(client, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(label + " sign-in failed: " + error.message);
  assert.ok(data.session?.access_token, label + " did not receive a real Auth session");
  return data.user.id;
}

const userA = await signIn(a, "device A");
const userB = await signIn(b, "device B");
assert.equal(userA, userB, "A and B must authenticate the same account");

const keyName = "pace.e2e.auth-sync." + Date.now();
const channelA = a.channel("e2e-a-" + userA);
const channelB = b.channel("e2e-b-" + userB);

function subscribed(channel, label) {
  return new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(label + " Realtime: " + status));
    });
  });
}

function waitFor(channel, marker, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime timeout: " + marker)), timeoutMs);
    channel.on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "user_state",
      filter: "user_id=eq." + userA,
    }, (payload) => {
      if (payload?.new?.key === keyName && payload?.new?.value?.marker === marker) {
        clearTimeout(timer);
        resolve(payload.new);
      }
    });
  });
}

async function write(client, marker) {
  const { data, error } = await client.rpc("upsert_user_state_if_newer", {
    p_user_id: userA,
    p_key: keyName,
    p_value: { marker, source: "real-auth-multi-device-test" },
    p_updated_at: new Date().toISOString(),
    p_updated_by: marker,
  });
  if (error) throw error;
  assert.equal(data?.accepted, true, "write " + marker + " was rejected");
}

await Promise.all([subscribed(channelA, "A"), subscribed(channelB, "B")]);

try {
  const seenByB = waitFor(channelB, "device-a");
  await write(a, "device-a");
  await seenByB;

  const seenByA = waitFor(channelA, "device-b");
  await write(b, "device-b");
  await seenByA;

  const { data, error } = await a.from("user_state")
    .select("key,value,updated_by")
    .eq("user_id", userA)
    .eq("key", keyName)
    .limit(1);
  if (error) throw error;
  assert.equal(data?.[0]?.value?.marker, "device-b");
  assert.equal(data?.[0]?.updated_by, "device-b");

  console.log("real-auth-multi-device-test: PASS");
} finally {
  await Promise.allSettled([
    a.removeChannel(channelA),
    b.removeChannel(channelB),
    a.auth.signOut(),
    b.auth.signOut(),
  ]);
}
