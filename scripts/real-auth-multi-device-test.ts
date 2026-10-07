import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
if (!oidcRequestUrl || !oidcRequestToken) throw new Error("GitHub Actions OIDC is not available; grant id-token: write to this job");

const timeoutMs = 20_000;
const brokerUrl = new URL("/functions/v1/github-e2e-auth", url).toString();

async function getGithubOidcToken() {
  const requestUrl = new URL(oidcRequestUrl);
  requestUrl.searchParams.set("audience", "paceos-supabase-e2e");
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(requestUrl, { headers: { Authorization: "bearer " + oidcRequestToken } });
    if (response.ok) {
      const body = await response.json() as { value?: string };
      if (!body.value) throw new Error("GitHub OIDC token response did not contain a value");
      return body.value;
    }
    lastStatus = response.status;
    if (attempt < 4 && (response.status === 408 || response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      continue;
    }
    break;
  }
  throw new Error("GitHub OIDC token request failed: HTTP " + lastStatus);
}

async function createRealAuthSessions(oidcToken: string) {
  const response = await fetch(brokerUrl, {
    method: "POST",
    headers: { Authorization: "Bearer " + oidcToken, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("E2E auth broker failed: " + (body.error ?? "HTTP " + response.status));
  return body as { user_id: string; a: { access_token: string; refresh_token: string }; b: { access_token: string; refresh_token: string } };
}

async function cleanupRealAuthUser(oidcToken: string, userId: string) {
  const response = await fetch(brokerUrl, {
    method: "POST",
    headers: { Authorization: "Bearer " + oidcToken, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cleanup", user_id: userId }),
  });
  if (!response.ok) console.error("E2E auth cleanup failed: HTTP " + response.status + " " + await response.text());
}

async function clientFromSession(session: { access_token: string; refresh_token: string }) {
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await client.auth.setSession(session);
  if (error) throw new Error("Failed to install E2E session: " + error.message);
  client.realtime.setAuth(session.access_token);
  return client;
}

function subscribeForEvent(client: SupabaseClient, channelName: string, event: "INSERT" | "UPDATE", userId: string, predicate: (payload: any) => boolean) {
  let channel: ReturnType<SupabaseClient["channel"]>;
  let settled = false;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  let eventResolve!: (payload: any) => void;
  let eventReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const received = new Promise<any>((resolve, reject) => { eventResolve = resolve; eventReject = reject; });

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
let oidcToken: string | null = null;
let userId: string | null = null;
let aClient: SupabaseClient | null = null;
let bClient: SupabaseClient | null = null;

try {
  oidcToken = await getGithubOidcToken();
  const sessions = await createRealAuthSessions(oidcToken);
  userId = sessions.user_id;

  aClient = await clientFromSession(sessions.a);
  console.log("A authenticated via ephemeral Supabase E2E account");
  bClient = await clientFromSession(sessions.b);
  console.log("B authenticated via ephemeral Supabase E2E account");

  const [{ data: aUser, error: aUserError }, { data: bUser, error: bUserError }] = await Promise.all([
    aClient.auth.getUser(),
    bClient.auth.getUser(),
  ]);
  if (aUserError) throw new Error("A getUser failed: " + aUserError.message);
  if (bUserError) throw new Error("B getUser failed: " + bUserError.message);
  if (!aUser || !bUser || aUser.user.id !== bUser.user.id || aUser.user.id !== userId) throw new Error("A and B are not the same Auth user");

  const bListener = subscribeForEvent(bClient, "paceos-e2e-B", "INSERT", userId, (p) => p.new?.key === keyName && p.new?.value?.phase === "A");
  const aListener = subscribeForEvent(aClient, "paceos-e2e-A", "UPDATE", userId, (p) => p.new?.key === keyName && p.new?.value?.phase === "B");

  await Promise.all([bListener.ready, aListener.ready]);
  console.log("A realtime: SUBSCRIBED");
  console.log("B realtime: SUBSCRIBED");

  const { error: insertError } = await aClient.from("user_state").upsert(
    { user_id: userId, key: keyName, value: { phase: "A", source: "device-A" }, updated_by: "device-A" },
    { onConflict: "user_id,key" },
  );
  if (insertError) throw new Error("A write failed: " + insertError.message);
  console.log("A write: phase=A");
  const insertPayload = await bListener.received;
  console.log("B received realtime INSERT from A");

  const { error: updateError } = await bClient.from("user_state").update(
    { value: { phase: "B", source: "device-B" }, updated_by: "device-B" },
  ).eq("user_id", userId).eq("key", keyName);
  if (updateError) throw new Error("B write failed: " + updateError.message);
  console.log("B write: phase=B");
  const updatePayload = await aListener.received;
  console.log("A received realtime UPDATE from B");

  const [{ data: finalA, error: finalAError }, { data: finalB, error: finalBError }] = await Promise.all([
    aClient.from("user_state").select("key,value,updated_by").eq("user_id", userId).eq("key", keyName).single(),
    bClient.from("user_state").select("key,value,updated_by").eq("user_id", userId).eq("key", keyName).single(),
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
  if (aClient && userId) await aClient.from("user_state").delete().eq("user_id", userId).eq("key", keyName).catch(() => undefined);
  await Promise.allSettled([aClient?.auth.signOut(), bClient?.auth.signOut()]);
  if (oidcToken && userId) await cleanupRealAuthUser(oidcToken, userId);
}
