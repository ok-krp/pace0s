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
  name: "add_food_log",
  title: "Add food log entry",
  description: "Insert a food_log entry for the signed-in user.",
  inputSchema: {
    name: z.string().min(1),
    meal: z.string().describe("breakfast | lunch | dinner | snack"),
    kcal: z.number().nonnegative(),
    protein_g: z.number().nonnegative().optional(),
    carbs_g: z.number().nonnegative().optional(),
    fat_g: z.number().nonnegative().optional(),
    fiber_g: z.number().nonnegative().optional(),
    sodium_mg: z.number().nonnegative().optional(),
    log_date: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    const row = {
      user_id: ctx.getUserId(),
      name: input.name,
      meal: input.meal,
      kcal: input.kcal,
      protein_g: input.protein_g ?? 0,
      carbs_g: input.carbs_g ?? 0,
      fat_g: input.fat_g ?? 0,
      fiber_g: input.fiber_g ?? null,
      sodium_mg: input.sodium_mg ?? null,
      log_date: input.log_date ?? new Date().toISOString().slice(0, 10),
    };
    const { data, error } = await sb.from("food_log").insert(row).select().single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { row: data },
    };
  },
});
