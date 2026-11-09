import { createClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { authenticateMcpRequest } from "./auth.ts";
import { resolveSupabaseAuthIssuer } from "./issuer.ts";
import { mcpDatabaseFailure } from "./errors.ts";
import { isOrderedIsoDateRange, isValidIsoDateOnly, isValidIsoTimestamp } from "./validation.ts";

const SERVER_NAME = "pace-mcp";
const SERVER_VERSION = "1.0.0";
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
const RESOURCE_PATH = "/mcp";

function withMcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, content-type, mcp-protocol-version, mcp-session-id");
  headers.set("access-control-expose-headers", "www-authenticate, mcp-session-id");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export function oauthProtectedResourceMetadata(request: Request): Response {
  const resource = new URL(RESOURCE_PATH, request.url).toString();
  const authorizationServer = resolveSupabaseAuthIssuer(
    process.env.SUPABASE_URL,
    import.meta.env?.VITE_SUPABASE_PROJECT_ID,
  );

  return jsonResponse({
    resource,
    authorization_servers: [authorizationServer],
    bearer_methods_supported: ["header"],
  }, 200, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  });
}

function createAuthenticatedServer(userId: string, accessToken: string): McpServer {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error("Supabase is not configured.");

  const db = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool("get_profile", {
    title: "Get my profile",
    description: "Return the signed-in user's coaching profile fields, excluding contact identifiers.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const { data, error } = await db
      .from("profiles")
      .select("display_name,age,sex,height_cm,weight_kg,weight_goal_kg,daily_calorie_goal,daily_protein_goal,daily_water_ml_goal,training_goal,activity_level")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return mcpDatabaseFailure("get_profile", error);
    return {
      content: [{ type: "text", text: JSON.stringify({ profile: data }) }],
      structuredContent: { profile: data },
    };
  });

  server.registerTool("list_food_log", {
    title: "List food log entries",
    description: "List the signed-in user's food_log entries, optionally filtered by date range (YYYY-MM-DD). Returns up to limit most recent rows.",
    inputSchema: {
      from: z.string().refine(isValidIsoDateOnly, "Expected a real calendar date in YYYY-MM-DD format").optional().describe("Start date YYYY-MM-DD (inclusive)"),
      to: z.string().refine(isValidIsoDateOnly, "Expected a real calendar date in YYYY-MM-DD format").optional().describe("End date YYYY-MM-DD (inclusive)"),
      limit: z.number().int().positive().optional().describe("Max rows (default 50, max 200)"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ from, to, limit }) => {
    if (!isOrderedIsoDateRange(from, to)) {
      return {
        content: [{ type: "text", text: "Invalid date range: start date must not be after end date." }],
        isError: true,
      };
    }
    let query = db
      .from("food_log")
      .select("id,log_date,meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg,health_score,source")
      .eq("user_id", userId)
      .order("log_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(Math.min(limit ?? 50, 200));
    if (from) query = query.gte("log_date", from);
    if (to) query = query.lte("log_date", to);
    const { data, error } = await query;
    if (error) return mcpDatabaseFailure("list_food_log", error);
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { rows: data ?? [] },
    };
  });

  server.registerTool("add_food_log", {
    title: "Add food log entry",
    description: "Insert a food_log entry for the signed-in user.",
    inputSchema: {
      name: z.string().trim().min(1).max(200),
      meal: z.string().trim().min(1).max(40).describe("breakfast | lunch | dinner | snack"),
      kcal: z.number().finite().nonnegative().max(100_000),
      protein_g: z.number().finite().nonnegative().max(10_000).optional(),
      carbs_g: z.number().finite().nonnegative().max(10_000).optional(),
      fat_g: z.number().finite().nonnegative().max(10_000).optional(),
      fiber_g: z.number().finite().nonnegative().max(10_000).optional(),
      sugar_g: z.number().finite().nonnegative().max(10_000).optional(),
      sodium_mg: z.number().finite().nonnegative().max(1_000_000).optional(),
      log_date: z.string().refine(isValidIsoDateOnly, "Expected a real calendar date in YYYY-MM-DD format").optional().describe("YYYY-MM-DD, defaults to today"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const row = {
      user_id: userId,
      name: input.name,
      meal: input.meal,
      kcal: input.kcal,
      protein_g: input.protein_g ?? 0,
      carbs_g: input.carbs_g ?? 0,
      fat_g: input.fat_g ?? 0,
      fiber_g: input.fiber_g ?? null,
      sugar_g: input.sugar_g ?? null,
      sodium_mg: input.sodium_mg ?? null,
      source: "manual",
      meta: { client: "pace_mcp", origin: "mcp" },
      log_date: input.log_date ?? new Date().toISOString().slice(0, 10),
    };
    const { data, error } = await db
      .from("food_log")
      .insert(row)
      .select("id,log_date,meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg,source,meta")
      .single();
    if (error) return mcpDatabaseFailure("add_food_log", error);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { row: data },
    };
  });

  server.registerTool("list_health_samples", {
    title: "List health samples",
    description: "List the signed-in user's health_samples (weight, steps, hr, sleep, etc.). Optional type filter and time range (ISO timestamps).",
    inputSchema: {
      type: z.string().trim().min(1).max(80).optional().describe("Sample type filter (e.g. weight, steps, hr)"),
      since: z.string().refine(isValidIsoTimestamp, "Expected an ISO-8601 timestamp with an explicit timezone").optional().describe("ISO-8601 timestamp with timezone — only samples after"),
      limit: z.number().int().positive().optional().describe("Max rows (default 100, max 500)"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ type, since, limit }) => {
    let query = db
      .from("health_samples")
      .select("id,type,value,ts,source")
      .eq("user_id", userId)
      .order("ts", { ascending: false })
      .limit(Math.min(limit ?? 100, 500));
    if (type) query = query.eq("type", type);
    if (since) query = query.gte("ts", since);
    const { data, error } = await query;
    if (error) return mcpDatabaseFailure("list_health_samples", error);
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { rows: data ?? [] },
    };
  });

  return server;
}

function unauthorizedResponse(request: Request): Response {
  const metadataUrl = new URL(RESOURCE_METADATA_PATH, request.url).toString();
  return jsonResponse({
    error: "unauthorized",
    error_description: "A valid Supabase bearer token is required.",
  }, 401, {
    "www-authenticate": `Bearer resource_metadata="${metadataUrl}"`,
  });
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withMcpCors(new Response(null, {
      status: 204,
      headers: { allow: "POST, OPTIONS" },
    }));
  }

  if (request.method !== "POST") {
    return withMcpCors(jsonResponse({ error: "method_not_allowed", message: "Use POST for the stateless MCP endpoint." }, 405, { allow: "POST, OPTIONS" }));
  }

  const auth = await authenticateMcpRequest(request);
  if (!auth.ok) {
    return withMcpCors(auth.status === 401 ? unauthorizedResponse(request) : jsonResponse({ error: "temporarily_unavailable", message: auth.message }, 503));
  }

  let server: McpServer | null = null;
  let transport: WebStandardStreamableHTTPServerTransport | null = null;
  try {
    server = createAuthenticatedServer(auth.context.userId, auth.context.accessToken);
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return withMcpCors(await transport.handleRequest(request));
  } catch (error) {
    console.error("[pace-mcp] request failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return withMcpCors(jsonResponse({ error: "internal_error", message: "MCP request failed." }, 500));
  } finally {
    await transport?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}
