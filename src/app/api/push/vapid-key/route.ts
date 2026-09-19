import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * The VAPID *public* key, which is public by design — it ships to every client
 * in the bundle already.
 *
 * The service worker needs it to re-subscribe after a `pushsubscriptionchange`,
 * and a service worker cannot read `NEXT_PUBLIC_*` at runtime.
 */
export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json({ error: "Push is not configured." }, { status: 503 });
  }
  return NextResponse.json(
    { key },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
