"use client";

import { createBrowserClient } from "@supabase/ssr";

import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "@/lib/env";
import type { Database } from "@/lib/database.types";

export function createClient() {
  return createBrowserClient<Database>(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY,
  );
}
