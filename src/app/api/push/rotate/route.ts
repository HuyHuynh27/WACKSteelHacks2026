import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  oldEndpoint: z.string().url(),
  /** The old subscription's auth secret, when the browser exposes it. */
  oldAuth: z.string().min(1).optional(),
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

function secretMatches(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Re-points a stored subscription at its replacement.
 *
 * Browsers rotate push subscriptions on their own schedule and fire
 * `pushsubscriptionchange` in the service worker. Nothing re-registers the new
 * endpoint on its own, so without this the row goes stale and the user simply
 * stops receiving alerts — no error surfaces anywhere.
 *
 * The event can fire with no page open and no usable session, so this route is
 * unauthenticated and instead authorises on knowledge of the *old* endpoint: a
 * high-entropy URL issued by the push service that only that browser and this
 * database hold. When the browser also hands us the old auth secret we check
 * that too. The service client is needed because there is no `auth.uid()` to
 * satisfy RLS; every write is pinned to the single row the caller proved it
 * knows.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { oldEndpoint, oldAuth, endpoint, keys } = parsed.data;
  const supabase = createServiceClient();

  const { data: existing, error: lookupError } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, auth")
    .eq("endpoint", oldEndpoint)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    // Already rotated, or never ours. The SW will fall back to subscribing.
    return NextResponse.json({ error: "Unknown subscription" }, { status: 404 });
  }
  if (oldAuth && !secretMatches(oldAuth, existing.auth)) {
    return NextResponse.json({ error: "Subscription mismatch" }, { status: 403 });
  }

  if (oldEndpoint === endpoint) {
    return NextResponse.json({ ok: true, rotated: false });
  }

  // The replacement may already be registered (a foreground subscribe raced
  // this event). Keep that row and retire the old one.
  const { data: replacement } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", endpoint)
    .maybeSingle();

  if (replacement) {
    await supabase.from("push_subscriptions").delete().eq("id", existing.id);
    return NextResponse.json({ ok: true, rotated: false, deduped: true });
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .update({
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rotated: true });
}
