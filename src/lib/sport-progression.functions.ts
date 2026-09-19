import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateSportProgressionServer } from "./sport-progression.server";

export const generateSportProgression = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({
    sessionId: z.string().uuid(),
    exerciseIds: z.array(z.string().uuid()).min(1).max(100),
  }).parse(data))
  .handler(({ data, context }) => generateSportProgressionServer(context, data));
