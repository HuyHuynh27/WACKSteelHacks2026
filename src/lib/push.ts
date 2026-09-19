import "server-only";

import webpush, { type PushSubscription, WebPushError } from "web-push";

import { requireEnv } from "@/lib/env";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:alerts@better-raw.app",
    requireEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    requireEnv("VAPID_PRIVATE_KEY"),
  );
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  alertId?: string;
};

export type SubscriptionRecord = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type DeliveryResult =
  | { id: string; ok: true }
  | { id: string; ok: false; gone: boolean; error: string };

function toWebPushSubscription(sub: SubscriptionRecord): PushSubscription {
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
}

/**
 * Sends to one subscription. `gone: true` means the browser has discarded the
 * subscription (404/410) and the row should be deleted.
 */
export async function sendToSubscription(
  sub: SubscriptionRecord,
  payload: PushPayload,
): Promise<DeliveryResult> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      toWebPushSubscription(sub),
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 },
    );
    return { id: sub.id, ok: true };
  } catch (error) {
    if (error instanceof WebPushError) {
      return {
        id: sub.id,
        ok: false,
        gone: error.statusCode === 404 || error.statusCode === 410,
        error: `${error.statusCode} ${error.body}`.trim(),
      };
    }
    return {
      id: sub.id,
      ok: false,
      gone: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendToMany(
  subs: SubscriptionRecord[],
  payload: PushPayload,
): Promise<DeliveryResult[]> {
  return Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
}
