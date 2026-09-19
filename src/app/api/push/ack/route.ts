import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({ alertId: z.string().uuid() });

/**
 * Marks an alert read because the user tapped its notification.
 *
 * Called from the service worker's `notificationclick` handler, so it runs with
 * the session cookie but without a page in the foreground. RLS scopes the
 * update to the caller's own alerts.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The SW fires this opportunistically and ignores the response; a signed-out
  // tap just opens the app and the alert stays unread.
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { error } = await supabase
    .from("alerts")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.alertId)
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
