// Supabase client shared by the browser and SSR runtime.
import { createClient } from "@supabase/supabase-js";
import type { PaceDatabase } from "./pace-database";

function createSupabaseClient() {
  // Browser-safe Supabase configuration: publishable keys are intended for public clients.
  // Prefer Vite env vars when configured, with the migrated PaceOS project as fallback.
  // Pin both values to the migrated project together. Mixing a stale Vercel
  // environment URL with the target project's publishable key (or vice versa)
  // makes auth and cloud sync fail even though the client initializes.
  const SUPABASE_URL = "https://cduyjejftorfuxuwhbqt.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_HWlyOrqPkDAdibQIKl-RCQ_i8ihwcyO";

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Configure them in the deployment environment.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<PaceDatabase>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
