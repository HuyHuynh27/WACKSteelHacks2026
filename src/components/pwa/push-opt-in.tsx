"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PUBLIC_VAPID_KEY } from "@/lib/env";

/** VAPID keys arrive base64url; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

type Status = "loading" | "unsupported" | "blocked" | "off" | "on";

export function PushOptIn({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status>("loading");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("blocked");
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      if (!cancelled) setStatus(existing ? "on" : "off");
    }

    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    if (!PUBLIC_VAPID_KEY) {
      toast.error("Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "blocked" : "off");
      toast.error("Notifications were not allowed.");
      return;
    }

    // In dev the registrar is a no-op, so register on demand.
    const registration =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
    await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
    });

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });

    if (!response.ok) {
      await subscription.unsubscribe();
      toast.error("Could not save the subscription. Try again.");
      return;
    }

    setStatus("on");
    toast.success("Price alerts are on for this device.");
  }, []);

  const unsubscribe = useCallback(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      setStatus("off");
      return;
    }

    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();

    setStatus("off");
    toast.success("Alerts off for this device.");
  }, []);

  const sendTest = useCallback(async () => {
    const response = await fetch("/api/push/test", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(payload.error ?? "Could not send the test notification.");
      return;
    }
    toast.success(`Test sent to ${payload.sent} device(s).`);
  }, []);

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await fn();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong.");
      }
    });

  if (status === "loading") return null;

  if (status === "unsupported") {
    return compact ? (
      <p className="text-sm text-muted-foreground">
        This browser does not support web push. On iOS, add Better RAW to your
        Home Screen first.
      </p>
    ) : null;
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {status === "on" ? (
        <>
          <Button variant="outline" size="sm" onClick={() => run(unsubscribe)} disabled={pending}>
            <BellOff className="size-4" aria-hidden />
            Turn off
          </Button>
          <Button variant="secondary" size="sm" onClick={() => run(sendTest)} disabled={pending}>
            Send a test
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => run(subscribe)} disabled={pending || status === "blocked"}>
          <BellRing className="size-4" aria-hidden />
          {pending ? "Enabling…" : "Enable price alerts"}
        </Button>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        {status === "blocked" && (
          <p className="text-sm text-muted-foreground">
            Notifications are blocked for this site. Re-allow them in your
            browser settings, then reload.
          </p>
        )}
        {status === "on" && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <Bell className="size-4" aria-hidden />
            This device is subscribed.
          </p>
        )}
        {controls}
      </div>
    );
  }

  return (
    <Card className="border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-sky-600" aria-hidden />
          Get told when prices move
        </CardTitle>
        <CardDescription>
          {status === "blocked"
            ? "Notifications are blocked for this site — re-allow them in your browser settings, then reload."
            : "Opt in and we will push you the size of the move plus the drivers behind it, not just a number."}
        </CardDescription>
      </CardHeader>
      <CardContent>{controls}</CardContent>
    </Card>
  );
}
