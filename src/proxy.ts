import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/session";

/**
 * Runs on every matched request to refresh the Supabase session cookie and
 * bounce anonymous visitors to /login. (Next 16 renamed this convention from
 * `middleware` to `proxy`.)
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets, the service worker, and image files.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)",
  ],
};
