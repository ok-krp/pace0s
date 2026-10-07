import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;

if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
if (!email || !password) throw new Error("E2E_TEST_EMAIL and E2E_TEST_PASSWORD are required");

const timeoutMs = 20_000;

async function session(label: string) {
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: email!, password: password! });
  if (error || !data.session || !data.user) throw new Error(label + " sign-in failed: " + (error?.message ?? "missing session"));
  return { client, user: data.user, session: data.session };
}

function subscribeForEvent(
  client: SupabaseClient,
  channelName: string,
  event: "INSERT" | "UPDATE",
  userId: string,
  predicate: (payload: any) => boolean,
) {
  let channel: ReturnType<SupabaseClient["channel"]>;
  let settled = false;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  let eventResolve!: (payload: any) => void;
  let eventReject!: (error: Error) => void;

  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const received = new Promise<any>((resolve, reject) => {
    eventResolve = resolve;
    eventReject = reject;
  });

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    const error = new Error("Timed out waiting for Realtime " + event + " on " + channelName);
    readyReject(error);
    eventReject(error);
    void client.removeChannel(channel);
  }, timeoutMs);

  channel = client.channel(channelName)
    .on("postgres_changes", { event, schema: "public", table: "user_state", filter: "user_id=eq." + userId }, (payload) => {
      if (!predicate(payload) || settled) return;
      settled = true;
      clearTimeout(timer);
      eventResolve(payload);
      void client.removeChannel(channel);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log(channelName + ": SUBSCRIBED");
        readyResolve();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = new Error("Realtime subscription " + channelName + " failed: " + status);
        readyReject(error);
        eventReject(error);
        void client.removeChannel(channel);
      }
    });

  return { ready, received };
}

const suffix = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
const keyName = "__paceos_real_auth_e2e__" + suffix;

let aSession: Awaited<ReturnType<typeof session>> | null = null;
let bSession: Awaited<ReturnType<typeof session>> | null = null;

try {
  aSession = await session("A");
  console.log("A authenticated");
  bSession = await session("B");
  console.log("B authenticated");

  if (aSession.user.id !== bSession.user.id) throw new Error("A and B are not the same Auth user");

  const bListener = subscribeForEvent(bSession.client, "paceos-e2e-B", "INSERT", aSession.user.id, (p) => p.new?.key === keyName && p.new?.value?.phase === "A");
  const aListener = subscribeForEvent(aSession.client, "paceos-e2e-A", "UPDATE", aSession.user.id, (p) => p.new?.key === keyName && p.new?.value?.phase === "B");

  await Promise.all([bListener.ready, aListener.ready]);
  console.log("A realtime: SUBSCRIBED");
  console.log("B realtime: SUBSCRIBED");

  const { error: insertError } = await aSession.client.from("user_state").upsert(
    { user_id: aSession.user.id, key: keyName, value: { phase: "A", source: "device-A" }, updated_by: "device-A" },
    { onConflict: "user_id,key" },
  );
  if (insertError) throw new Error("A write failed: " + insertError.message);
  console.log("A write: phase=A");
  const insertPayload = await bListener.received;
  console.log("B received realtime INSERT from A");

  const { error: updateError } = await bSession.client.from("user_state").update(
    { value: { phase: "B", source: "device-B" }, updated_by: "device-B" },
  ).eq("user_id", aSession.user.id).eq("key", keyName);
  if (updateError) throw new Error("B write failed: " + updateError.message);
  console.log("B write: phase=B");
  const updatePayload = await aListener.received;
  console.log("A received realtime UPDATE from B");

  const [{ data: finalA, error: finalAError }, { data: finalB, error: finalBError }] = await Promise.all([
    aSession.client.from("user_state").select("key,value,updated_by").eq("user_id", aSession.user.id).eq("key", keyName).single(),
    bSession.client.from("user_state").select("key,value,updated_by").eq("user_id", aSession.user.id).eq("key", keyName).single(),
  ]);
  if (finalAError) throw new Error("A final read failed: " + finalAError.message);
  if (finalBError) throw new Error("B final read failed: " + finalBError.message);
  if (finalA?.value?.phase !== "B" || finalB?.value?.phase !== "B") throw new Error("Final state did not converge to B");
  if (insertPayload.new?.value?.phase !== "A") throw new Error("B did not observe A");
  if (updatePayload.new?.value?.phase !== "B") throw new Error("A did not observe B");

  console.log("A final state: phase=B");
  console.log("B final state: phase=B");
  console.log("real-auth-multi-device-test: PASS");
  console.log("A -> Realtime -> B -> B update -> Realtime -> A: PASS");
} catch (error) {
  console.error("real-auth-multi-device-test: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (aSession) {
    await aSession.client.from("user_state").delete().eq("user_id", aSession.user.id).eq("key", keyName).catch(() => undefined);
  }
  await Promise.allSettled([
    aSession?.client.auth.signOut(),
    bSession?.client.auth.signOut(),
  ]);
}
