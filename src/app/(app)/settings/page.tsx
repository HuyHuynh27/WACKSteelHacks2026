import { NotificationPrefsForm } from "@/components/notification-prefs-form";
import { PushOptIn } from "@/components/pwa/push-opt-in";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getNotificationPrefs } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [prefs, { data: profile }, { data: devices }] = await Promise.all([
    getNotificationPrefs(),
    supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle(),
    supabase
      .from("push_subscriptions")
      .select("id, user_agent, created_at")
      .eq("user_id", user!.id),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          {profile?.company_name ?? user?.email}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Push notifications</CardTitle>
          <CardDescription>
            Alerts are per-device: enable this on every phone or desktop you want
            to be reached on.
            {devices?.length
              ? ` ${devices.length} device${devices.length === 1 ? "" : "s"} currently subscribed.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PushOptIn compact />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When to notify</CardTitle>
          <CardDescription>
            These apply account-wide. A material can also set its own threshold.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPrefsForm
            prefs={
              prefs ?? {
                user_id: user!.id,
                enabled: false,
                min_change_pct: 5,
                digest: "daily",
                quiet_hours_start: 21,
                quiet_hours_end: 7,
                updated_at: new Date().toISOString(),
              }
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Install Better RAW</CardTitle>
          <CardDescription>
            It is a progressive web app — install it and it behaves like a native
            app, offline shell included.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">iOS Safari:</span> Share
            → Add to Home Screen. Push notifications only work once installed.
          </p>
          <p>
            <span className="font-medium text-foreground">Android Chrome:</span>{" "}
            menu → Install app.
          </p>
          <p>
            <span className="font-medium text-foreground">Desktop:</span> the
            install icon in the address bar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
