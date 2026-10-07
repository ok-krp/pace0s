import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");

const timeoutMs = 20_000;

async function session(label: string, email: string, password: string) {
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) throw new Error(label + " sign-in failed: " + (error?.message ?? "missing session"));
  return { client, user: data.user, session: data.session };
}

async function waitForEvent(client: SupabaseClient, channelName: string, event: "INSERT" | "UPDATE", userId: string, predicate: (payload: any) => boolean) {
  return await new Promise<any>((resolve, reject) => {
    const channel = client.channel(channelName)
      .on("postgres_changes", { event, schema: "public", table: "user_state", filter: "user_id=eq." + userId }, (payload) => {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        void client.removeChannel(channel);
        resolve(payload);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          void client.removeChannel(channel);
          reject(new Error("Realtime subscription " + channelName + " failed: " + status));
        }
      });
    const timer = setTimeout(() => {
      void client.removeChannel(channel);
      reject(new Error("Timed out waiting for Realtime " + event));
    }, timeoutMs);
  });
}

const suffix = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
const email = "paceos-realtime-e2e-" + suffix + "@example.com";
const password = "PaceOS-E2E-" + crypto.randomUUID() + "!aA9";
const keyName = "__paceos_real_auth_e2e__" + suffix;
const a = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

try {
  const signup = await a.auth.signUp({ email, password });
  if (signup.error) throw new Error("A sign-up failed: " + signup.error.message);
  if (!signup.data.user) throw new Error("A sign-up returned no user");
  if (!signup.data.session) throw new Error("A sign-up returned no session; email confirmation is required.");

  const bSession = await session("B", email, password);
  const aSession = { client: a, user: signup.data.user, session: signup.data.session };
  if (aSession.user.id !== bSession.user.id) throw new Error("A and B are not the same Auth user");

  const insertSeenByB = waitForEvent(bSession.client, "paceos-e2e-B", "INSERT", aSession.user.id, (p) => p.new?.key === keyName && p.new?.value?.phase === "A");
  const updateSeenByA = waitForEvent(aSession.client, "paceos-e2e-A", "UPDATE", aSession.user.id, (p) => p.new?.key === keyName && p.new?.value?.phase === "B");

  const { error: insertError } = await aSession.client.from("user_state").upsert(
    { user_id: aSession.user.id, key: keyName, value: { phase: "A", source: "device-A" }, updated_by: "device-A" },
    { onConflict: "user_id,key" },
  );
  if (insertError) throw new Error("A write failed: " + insertError.message);
  const insertPayload = await insertSeenByB;

  const { error: updateError } = await bSession.client.from("user_state").update(
    { value: { phase: "B", source: "device-B" }, updated_by: "device-B" },
  ).eq("user_id", aSession.user.id).eq("key", keyName);
  if (updateError) throw new Error("B write failed: " + updateError.message);
  const updatePayload = await updateSeenByA;

  const [{ data: finalA, error: finalAError }, { data: finalB, error: finalBError }] = await Promise.all([
    aSession.client.from("user_state").select("key,value,updated_by").eq("user_id", aSession.user.id).eq("key", keyName).single(),
    bSession.client.from("user_state").select("key,value,updated_by").eq("user_id", aSession.user.id).eq("key", keyName).single(),
  ]);
  if (finalAError) throw new Error("A final read failed: " + finalAError.message);
  if (finalBError) throw new Error("B final read failed: " + finalBError.message);
  if (finalA?.value?.phase !== "B" || finalB?.value?.phase !== "B") throw new Error("Final state did not converge to B");
  if (insertPayload.new?.value?.phase !== "A") throw new Error("B did not observe A");
  if (updatePayload.new?.value?.phase !== "B") throw new Error("A did not observe B");

  await aSession.client.from("user_state").delete().eq("user_id", aSession.user.id).eq("key", keyName);
  await Promise.allSettled([aSession.client.auth.signOut(), bSession.client.auth.signOut()]);
  console.log("real-auth-multi-device-test: PASS");
  console.log("A -> Realtime -> B -> B update -> Realtime -> A: PASS");
} catch (error) {
  console.error("real-auth-multi-device-test: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
