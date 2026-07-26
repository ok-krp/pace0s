import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_health_samples",
  title: "List health samples",
  description:
    "List the signed-in user's health_samples (weight, steps, hr, sleep, etc.). Optional type filter and time range (ISO timestamps).",
  inputSchema: {
    type: z.string().optional().describe("Sample type filter (e.g. weight, steps, hr)"),
    since: z.string().optional().describe("ISO timestamp — only samples after"),
    limit: z.number().int().positive().optional().describe("Max rows (default 100)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ type, since, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("health_samples")
      .select("id,type,value,ts,source")
      .eq("user_id", ctx.getUserId())
      .order("ts", { ascending: false })
      .limit(Math.min(limit ?? 100, 500));
    if (type) q = q.eq("type", type);
    if (since) q = q.gte("ts", since);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});
