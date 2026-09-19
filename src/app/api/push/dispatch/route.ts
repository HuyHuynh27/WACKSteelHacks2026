import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { decideDelivery, type DeliveryDecision } from "@/lib/notifications";
import { sendToMany } from "@/lib/push";
import { createServiceClient } from "@/lib/supabase/server";
import type { Alert, NotificationPrefs } from "@/lib/database.types";

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

/**
 * Fans out every undelivered alert over web-push.
 *
 * Called by the Python ingestion worker (`ingestion/better_raw/dispatch.py`)
 * with the shared `x-cron-secret` header. Lives here rather than in Python so
 * the VAPID private key only exists in one place.
 *
 * Alerts are grouped per user because the digest preference batches a user's
 * moves into a single notification. An alert is only marked delivered once at
 * least one device actually accepted it — a failed send leaves it pending for
 * the next run rather than silently swallowing it.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("*")
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!alerts?.length) {
    return NextResponse.json({ delivered: 0, deferred: 0, dropped: 0, message: "No pending alerts." });
  }

  const userIds = [...new Set(alerts.map((a) => a.user_id))];

  const [{ data: prefs }, { data: subs }] = await Promise.all([
    supabase.from("notification_prefs").select("*").in("user_id", userIds),
    supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds),
  ]);

  const prefsByUser = new Map<string, NotificationPrefs>(
    (prefs ?? []).map((p) => [p.user_id, p]),
  );
  const subsByUser = new Map<string, NonNullable<typeof subs>>();
  for (const sub of subs ?? []) {
    subsByUser.set(sub.user_id, [...(subsByUser.get(sub.user_id) ?? []), sub]);
  }

  const alertsByUser = new Map<string, Alert[]>();
  for (const alert of alerts) {
    alertsByUser.set(alert.user_id, [...(alertsByUser.get(alert.user_id) ?? []), alert]);
  }

  const now = new Date();
  const nowIso = now.toISOString();

  const staleSubscriptionIds = new Set<string>();
  const usedSubscriptionIds = new Set<string>();
  const deliveredAlertIds: string[] = [];
  const droppedAlertIds: string[] = [];
  const digestSentUserIds: string[] = [];
  let deferred = 0;
  let failed = 0;

  for (const [userId, userAlerts] of alertsByUser) {
    const userSubs = subsByUser.get(userId) ?? [];
    const decisions: DeliveryDecision[] = decideDelivery({
      alerts: userAlerts,
      prefs: prefsByUser.get(userId) ?? null,
      deviceCount: userSubs.length,
      now,
    });

    for (const decision of decisions) {
      if (decision.action === "drop") {
        droppedAlertIds.push(...decision.alerts.map((a) => a.id));
        continue;
      }
      if (decision.action === "defer") {
        deferred += decision.alerts.length;
        continue;
      }

      const results = await sendToMany(userSubs, decision.payload);
      for (const result of results) {
        if (result.ok) usedSubscriptionIds.add(result.id);
        else if (result.gone) staleSubscriptionIds.add(result.id);
      }

      if (results.some((r) => r.ok)) {
        deliveredAlertIds.push(...decision.alerts.map((a) => a.id));
        if (decision.digest) digestSentUserIds.push(userId);
      } else {
        // Every device rejected it. Leave the alerts pending and retry later.
        failed += decision.alerts.length;
      }
    }
  }

  const writes: PromiseLike<unknown>[] = [];

  if (deliveredAlertIds.length) {
    writes.push(
      supabase.from("alerts").update({ delivered_at: nowIso }).in("id", deliveredAlertIds),
    );
  }
  if (droppedAlertIds.length) {
    // Retired, not sent — stops them being rescanned every run.
    writes.push(
      supabase.from("alerts").update({ delivered_at: nowIso }).in("id", droppedAlertIds),
    );
  }
  if (digestSentUserIds.length) {
    writes.push(
      supabase
        .from("notification_prefs")
        .update({ digest_sent_at: nowIso })
        .in("user_id", digestSentUserIds),
    );
  }
  if (usedSubscriptionIds.size) {
    writes.push(
      supabase
        .from("push_subscriptions")
        .update({ last_used_at: nowIso })
        .in("id", [...usedSubscriptionIds]),
    );
  }
  if (staleSubscriptionIds.size) {
    writes.push(
      supabase.from("push_subscriptions").delete().in("id", [...staleSubscriptionIds]),
    );
  }

  await Promise.all(writes);

  return NextResponse.json({
    delivered: deliveredAlertIds.length,
    dropped: droppedAlertIds.length,
    deferred,
    failed,
    prunedSubscriptions: staleSubscriptionIds.size,
  });
}
