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
  name: "list_food_log",
  title: "List food log entries",
  description:
    "List the signed-in user's food_log entries, optionally filtered by date range (YYYY-MM-DD). Returns up to `limit` most recent rows.",
  inputSchema: {
    from: z.string().optional().describe("Start date YYYY-MM-DD (inclusive)"),
    to: z.string().optional().describe("End date YYYY-MM-DD (inclusive)"),
    limit: z.number().int().positive().optional().describe("Max rows (default 50)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("food_log")
      .select("id,log_date,meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,health_score,source")
      .eq("user_id", ctx.getUserId())
      .order("log_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(Math.min(limit ?? 50, 200));
    if (from) q = q.gte("log_date", from);
    if (to) q = q.lte("log_date", to);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});
