import { createClient } from "@supabase/supabase-js";
import { mcpDatabaseFailure } from "../errors";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isValidIsoDateOnly } from "../validation";

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
    name: z.string().trim().min(1).max(200),
    meal: z.string().trim().min(1).max(40).describe("breakfast | lunch | dinner | snack"),
    kcal: z.number().finite().nonnegative(),
    protein_g: z.number().finite().nonnegative().optional(),
    carbs_g: z.number().finite().nonnegative().optional(),
    fat_g: z.number().finite().nonnegative().optional(),
    fiber_g: z.number().finite().nonnegative().optional(),
    sugar_g: z.number().finite().nonnegative().optional(),
    sodium_mg: z.number().finite().nonnegative().optional(),
    log_date: z.string().refine(isValidIsoDateOnly, "Expected a real calendar date in YYYY-MM-DD format").optional().describe("YYYY-MM-DD, defaults to today"),
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
      sugar_g: input.sugar_g ?? null,
      sodium_mg: input.sodium_mg ?? null,
      source: "mcp",
      log_date: input.log_date ?? new Date().toISOString().slice(0, 10),
    };
    const { data, error } = await sb.from("food_log").insert(row).select().single();
    if (error) return mcpDatabaseFailure("add_food_log", error);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { row: data },
    };
  },
});
