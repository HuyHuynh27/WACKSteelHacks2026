import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL, requireEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/** Request-scoped client that reads/writes the auth cookies. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — middleware already refreshed
            // the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Bypasses RLS. Only use in route handlers that have already authenticated the
 * caller some other way (e.g. the cron secret on the push dispatcher).
 */
export function createServiceClient() {
  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
