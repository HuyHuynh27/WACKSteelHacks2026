/**
 * Delivery rules for price alerts: who gets pushed, when, and what the
 * notification says.
 *
 * Deliberately free of Supabase and `web-push` so the decisions can be reasoned
 * about (and tested) on their own — the dispatch route supplies the rows and
 * performs the sends.
 */

import type { Alert, DigestFrequency, NotificationPrefs } from "@/lib/database.types";
import type { PushPayload } from "@/lib/push";

/** How long a batched digest waits between sends. `instant` never batches. */
const DIGEST_INTERVAL_MS: Record<DigestFrequency, number> = {
  instant: 0,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** Matches the cap the ingestion worker applies to alert bodies. */
const MAX_BODY_CHARS = 180;

export type DeliveryDecision =
  /** Push now. `alerts` is what the payload covers. */
  | { action: "send"; payload: PushPayload; alerts: Alert[]; digest: boolean }
  /** Not yet — leave the alerts pending so a later run can pick them up. */
  | { action: "defer"; reason: "quiet-hours" | "digest-window"; alerts: Alert[] }
  /** Never going to be sent — retire the alerts so they stop being scanned. */
  | { action: "drop"; reason: "disabled" | "no-devices" | "below-floor"; alerts: Alert[] };

/**
 * True when `hourUtc` falls inside the quiet window, which may wrap midnight
 * (21 -> 7 means 21:00–23:59 and 00:00–06:59).
 */
export function isQuietHour(hourUtc: number, start: number, end: number): boolean {
  if (start === end) return false; // Zero-width window: never quiet.
  return start < end ? hourUtc >= start && hourUtc < end : hourUtc >= start || hourUtc < end;
}

/** Whether enough time has passed since the last batched digest. */
export function isDigestDue(
  digest: DigestFrequency,
  digestSentAt: string | null,
  now: Date,
): boolean {
  if (digest === "instant") return true;
  if (!digestSentAt) return true; // Never sent one — don't make them wait.

  const last = new Date(digestSentAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= DIGEST_INTERVAL_MS[digest];
}

function truncate(text: string, max = MAX_BODY_CHARS): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The notification for a single price move. */
export function alertPayload(alert: Alert): PushPayload {
  return {
    title: alert.headline,
    body: truncate(alert.body),
    url: `/materials/${alert.material_id}`,
    // Per-material, so a newer move for the same material replaces the old one
    // on the lock screen rather than stacking up.
    tag: `alert-${alert.material_id}`,
    alertId: alert.id,
  };
}

/** One notification summarising several moves, for daily/weekly subscribers. */
export function digestPayload(alerts: Alert[], digest: DigestFrequency): PushPayload {
  if (alerts.length === 1) {
    return { ...alertPayload(alerts[0]), tag: "better-raw-digest" };
  }

  // Biggest movers lead — that's what a purchasing manager acts on.
  const ranked = [...alerts].sort(
    (a, b) => Math.abs(Number(b.pct_change)) - Math.abs(Number(a.pct_change)),
  );
  const period = digest === "weekly" ? "this week" : "today";
  const lead = ranked
    .slice(0, 2)
    .map((a) => a.headline.trim().replace(/[.]$/, ""))
    .join(" · ");
  const rest = ranked.length - 2;

  return {
    title: `${ranked.length} materials moved ${period}`,
    body: truncate(rest > 0 ? `${lead} · and ${rest} more.` : `${lead}.`),
    url: "/alerts",
    tag: "better-raw-digest",
  };
}

/**
 * Decides what to do with one user's pending alerts.
 *
 * `prefs` is null when the user has never opted in, which is a drop rather than
 * a defer — no devices will ever appear for an account that never subscribed.
 */
export function decideDelivery(input: {
  alerts: Alert[];
  prefs: NotificationPrefs | null;
  deviceCount: number;
  now: Date;
}): DeliveryDecision[] {
  const { alerts, prefs, deviceCount, now } = input;

  if (!prefs?.enabled) return [{ action: "drop", reason: "disabled", alerts }];
  if (deviceCount === 0) return [{ action: "drop", reason: "no-devices", alerts }];

  const floor = Number(prefs.min_change_pct);
  const decisions: DeliveryDecision[] = [];

  // The worker already applied each material's own threshold; this is the
  // account-wide floor sitting underneath it.
  const belowFloor = alerts.filter((a) => Math.abs(Number(a.pct_change)) < floor);
  const eligible = alerts.filter((a) => Math.abs(Number(a.pct_change)) >= floor);

  if (belowFloor.length) {
    decisions.push({ action: "drop", reason: "below-floor", alerts: belowFloor });
  }
  if (!eligible.length) return decisions;

  // Quiet hours hold everything back rather than discarding it.
  if (isQuietHour(now.getUTCHours(), prefs.quiet_hours_start, prefs.quiet_hours_end)) {
    decisions.push({ action: "defer", reason: "quiet-hours", alerts: eligible });
    return decisions;
  }

  if (prefs.digest === "instant") {
    for (const alert of eligible) {
      decisions.push({
        action: "send",
        payload: alertPayload(alert),
        alerts: [alert],
        digest: false,
      });
    }
    return decisions;
  }

  if (!isDigestDue(prefs.digest, prefs.digest_sent_at, now)) {
    decisions.push({ action: "defer", reason: "digest-window", alerts: eligible });
    return decisions;
  }

  decisions.push({
    action: "send",
    payload: digestPayload(eligible, prefs.digest),
    alerts: eligible,
    digest: true,
  });
  return decisions;
}
