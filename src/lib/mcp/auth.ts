import { createClient } from "@supabase/supabase-js";

export type McpAuthContext = {
  userId: string;
  accessToken: string;
};

export type McpAuthResult =
  | { ok: true; context: McpAuthContext }
  | { ok: false; status: 401 | 503; message: string };

export function extractMcpBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer\\s+([^\\s]+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

/**
 * Validate the presented Supabase access token with Auth (never decode JWT
 * claims locally), then bind all database requests to this exact bearer token.
 */
export async function authenticateMcpRequest(request: Request): Promise<McpAuthResult> {
  const accessToken = extractMcpBearerToken(request);
  if (!accessToken) {
    return { ok: false, status: 401, message: "A Supabase OAuth bearer token is required." };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return { ok: false, status: 503, message: "MCP authentication is not configured." };
  }

  try {
    const supabase = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user?.id) {
      return { ok: false, status: 401, message: "The Supabase access token is invalid or expired." };
    }
    return { ok: true, context: { userId: data.user.id, accessToken } };
  } catch {
    // A network/Auth outage is not treated as a successful authentication.
    return { ok: false, status: 503, message: "The authentication service is temporarily unavailable." };
  }
}
