export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Better RAW cached the pages you visited most recently. Reconnect to pull
        fresh prices and alerts.
      </p>
    </main>
  );
}
