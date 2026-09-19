import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { sendToMany, type PushPayload } from "@/lib/push";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 200;

function secretMatches(provided: string | null) {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isQuietHour(hourUtc: number, start: number, end: number) {
  // Window may wrap midnight (e.g. 21 -> 7).
  return start <= end ? hourUtc >= start && hourUtc < end : hourUtc >= start || hourUtc < end;
}

/**
 * Fans out every undelivered alert over web-push.
 *
 * Called by the Python ingestion worker (see ingestion/dispatch_alerts.py)
 * with the shared `x-cron-secret` header. Lives here rather than in Python so
 * the VAPID private key only exists in one place.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("id, user_id, headline, body, pct_change, material_id")
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!alerts?.length) {
    return NextResponse.json({ delivered: 0, skipped: 0, message: "No pending alerts." });
  }

  const userIds = [...new Set(alerts.map((a) => a.user_id))];

  const [{ data: prefs }, { data: subs }] = await Promise.all([
    supabase
      .from("notification_prefs")
      .select("user_id, enabled, min_change_pct, quiet_hours_start, quiet_hours_end")
      .in("user_id", userIds),
    supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds),
  ]);

  const prefsByUser = new Map((prefs ?? []).map((p) => [p.user_id, p]));
  const subsByUser = new Map<string, typeof subs>();
  for (const sub of subs ?? []) {
    subsByUser.set(sub.user_id, [...(subsByUser.get(sub.user_id) ?? []), sub]);
  }

  const hourUtc = new Date().getUTCHours();
  const staleSubscriptionIds = new Set<string>();
  const retiredAlertIds: string[] = [];
  let delivered = 0;
  let skipped = 0;

  for (const alert of alerts) {
    const pref = prefsByUser.get(alert.user_id);
    const userSubs = subsByUser.get(alert.user_id) ?? [];

    const belowThreshold =
      pref != null && Math.abs(Number(alert.pct_change)) < Number(pref.min_change_pct);
    const quiet =
      pref != null && isQuietHour(hourUtc, pref.quiet_hours_start, pref.quiet_hours_end);

    if (!pref?.enabled || !userSubs.length || belowThreshold) {
      // Nothing to send, and never will be — retire the alert.
      retiredAlertIds.push(alert.id);
      skipped += 1;
      continue;
    }
    if (quiet) {
      // Leave undelivered so the next run picks it up outside quiet hours.
      skipped += 1;
      continue;
    }

    const payload: PushPayload = {
      title: alert.headline,
      body: alert.body,
      url: `/materials/${alert.material_id}`,
      tag: `alert-${alert.material_id}`,
      alertId: alert.id,
    };

    const results = await sendToMany(userSubs, payload);
    for (const result of results) {
      if (!result.ok && result.gone) staleSubscriptionIds.add(result.id);
    }
    retiredAlertIds.push(alert.id);
    delivered += 1;
  }

  if (retiredAlertIds.length) {
    await supabase
      .from("alerts")
      .update({ delivered_at: new Date().toISOString() })
      .in("id", retiredAlertIds);
  }
  if (staleSubscriptionIds.size) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .in("id", [...staleSubscriptionIds]);
  }

  return NextResponse.json({
    delivered,
    skipped,
    prunedSubscriptions: staleSubscriptionIds.size,
  });
}
