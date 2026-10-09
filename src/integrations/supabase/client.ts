// Supabase client shared by the browser and SSR runtime.
import { createClient } from "@supabase/supabase-js";
import type { PaceDatabase } from "./pace-database";

function createSupabaseClient() {
  // Never combine a URL from one configuration source with a key from another.
  // A mismatched pair can silently route auth and cloud-sync requests to the wrong project.
  const viteUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const viteKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const serverUrl = typeof process !== "undefined" ? process.env.SUPABASE_URL?.trim() : undefined;
  const serverKey = typeof process !== "undefined" ? process.env.SUPABASE_PUBLISHABLE_KEY?.trim() : undefined;

  const hasViteConfig = Boolean(viteUrl || viteKey);
  const hasServerConfig = Boolean(serverUrl || serverKey);
  const config = hasViteConfig
    ? { url: viteUrl, key: viteKey, source: "VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY" }
    : { url: serverUrl, key: serverKey, source: "SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY" };

  if (!config.url || !config.key) {
    const message = hasViteConfig && hasServerConfig
      ? "Incomplete Supabase configuration: set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, or both server-side SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. Values from different pairs are never mixed."
      : `Missing or incomplete Supabase configuration. Set both ${config.source} variables in the deployment environment.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(config.url);
  } catch {
    throw new Error("[Supabase] SUPABASE_URL must be a valid absolute URL.");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost") {
    throw new Error("[Supabase] SUPABASE_URL must use HTTPS outside localhost.");
  }

  return createClient<PaceDatabase>(parsedUrl.toString().replace(/\/$/, ""), config.key, {
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
