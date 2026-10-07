import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6";

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_AUDIENCE = "paceos-supabase-e2e";
const GITHUB_JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const secretKey = secretKeys.default;
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const publishableKey = publishableKeys.default;
const supabaseUrl = Deno.env.get("SUPABASE_URL");

if (!secretKey || !publishableKey || !supabaseUrl) throw new Error("Supabase function keys are not configured");

const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

async function authorize(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new Error("Missing GitHub OIDC bearer token");
  const token = header.slice("Bearer ".length);
  const { payload } = await jwtVerify(token, GITHUB_JWKS, {
    issuer: GITHUB_ISSUER,
    audience: GITHUB_AUDIENCE,
  });
  if (payload.repository !== "ok-krp/pace0s") throw new Error("GitHub repository is not allowed");
  if (payload.workflow !== "Cloud Sync Audit") throw new Error("GitHub workflow is not allowed");
  if (payload.event_name !== "pull_request") throw new Error("GitHub event is not allowed");
  return payload;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  try {
    const claims = await authorize(request);
    const body = await request.json().catch(() => ({}));

    if (body.action === "cleanup") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      if (!userId) return new Response(JSON.stringify({ error: "user_id is required" }), { status: 400, headers: corsHeaders });
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    const runId = String(claims.run_id ?? "unknown");
    const runAttempt = String(claims.run_attempt ?? "1");
    const email = "paceos-e2e+" + runId + "-" + runAttempt + "-" + crypto.randomUUID() + "@example.com";
    const password = crypto.randomUUID() + "-" + crypto.randomUUID();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { paceos_e2e: true, github_run_id: runId },
    });
    if (createError || !created.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Failed to create E2E user" }), { status: 500, headers: corsHeaders });
    }

    const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const [a, b] = await Promise.all([
      client.auth.signInWithPassword({ email, password }),
      client.auth.signInWithPassword({ email, password }),
    ]);

    if (a.error || b.error || !a.data.session || !b.data.session) {
      await admin.auth.admin.deleteUser(created.user.id);
      return new Response(JSON.stringify({
        error: "Failed to create two authenticated E2E sessions",
        detail: a.error?.message ?? b.error?.message ?? "missing session",
      }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      user_id: created.user.id,
      a: { access_token: a.data.session.access_token, refresh_token: a.data.session.refresh_token },
      b: { access_token: b.data.session.access_token, refresh_token: b.data.session.refresh_token },
    }), { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
});
