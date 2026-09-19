/* Better RAW service worker — offline shell + web push. */

const CACHE = "better-raw-v2";
const APP_SHELL = ["/", "/dashboard", "/offline", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one 404 doesn't fail the whole install.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for navigations so data stays fresh; fall back to cache offline.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? caches.match("/offline")),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Better RAW", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Better RAW";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || "better-raw-alert",
      renotify: true,
      data: { url: payload.url || "/alerts", alertId: payload.alertId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const target = data.url || "/alerts";

  event.waitUntil(
    (async () => {
      // Tapping the notification is as good as reading the alert. Fire and
      // forget — a failure here must not stop the app from opening.
      if (data.alertId) {
        try {
          await fetch("/api/push/ack", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ alertId: data.alertId }),
          });
        } catch {
          /* offline, or signed out — the alert just stays unread. */
        }
      }

      const targetUrl = new URL(target, self.location.origin);
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Reuse an open window rather than piling up tabs, navigating it to the
      // material the alert is about.
      for (const client of clientList) {
        if (new URL(client.url).origin !== targetUrl.origin) continue;
        if ("focus" in client) {
          const focused = await client.focus();
          if (focused && "navigate" in focused && focused.url !== targetUrl.href) {
            try {
              await focused.navigate(targetUrl.href);
            } catch {
              /* Cross-document navigation can be refused; focus is enough. */
            }
          }
          return;
        }
      }

      await self.clients.openWindow(targetUrl.href);
    })(),
  );
});

/* VAPID keys arrive base64url; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = self.atob(normalised);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/**
 * Browsers rotate push subscriptions on their own schedule. Without this the
 * stored endpoint goes stale and alerts stop arriving with no visible error —
 * so re-subscribe and hand the server the new endpoint.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const oldSubscription = event.oldSubscription;
      const oldEndpoint = oldSubscription?.endpoint;

      // Prefer the key the old subscription was created with; fall back to
      // asking the server, since a SW cannot read NEXT_PUBLIC_* itself.
      let applicationServerKey = oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) {
        const response = await fetch("/api/push/vapid-key");
        if (!response.ok) return;
        const { key } = await response.json();
        applicationServerKey = urlBase64ToUint8Array(key);
      }

      const subscription =
        event.newSubscription ??
        (await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        }));

      const json = subscription.toJSON();

      if (oldEndpoint) {
        const rotated = await fetch("/api/push/rotate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            oldEndpoint,
            oldAuth: oldSubscription?.toJSON?.().keys?.auth,
            endpoint: json.endpoint,
            keys: json.keys,
          }),
        }).catch(() => null);

        if (rotated?.ok) return;
      }

      // No old endpoint to match on (or it was already gone) — register the new
      // subscription the normal way. Needs a session, so it may no-op.
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(json),
      }).catch(() => null);
    })(),
  );
});
