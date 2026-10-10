// Server-side Supabase client with an elevated Supabase secret key.
// Use this only for trusted server operations; never expose it to the browser.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

function createSupabaseAdminClient() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  // Prefer the current Supabase secret-key name, while keeping legacy service_role compatibility.
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ['SUPABASE_URL'] : []),
      ...(!SUPABASE_SECRET_KEY ? ['SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)'] : []),
    ];
    const message = `Missing server Supabase environment variable(s): ${missing.join(', ')}. Configure them in Vercel Environment Variables.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(SUPABASE_URL);
  } catch {
    throw new Error("[Supabase] SUPABASE_URL must be a valid absolute URL.");
  }
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (parsedUrl.protocol !== "https:" && !isLocalHost) {
    throw new Error("[Supabase] SUPABASE_URL must use HTTPS outside localhost.");
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error("[Supabase] SUPABASE_URL must not contain credentials, query parameters, or a fragment.");
  }

  return createClient<Database>(parsedUrl.toString().replace(/\/$/, ""), SUPABASE_SECRET_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

// SECURITY: Only use this for trusted server-side operations, never expose to client code.
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
