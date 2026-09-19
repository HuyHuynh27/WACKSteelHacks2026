import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BellOff } from "lucide-react";

import { markAllAlertsRead } from "@/app/(app)/alerts/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { getRecentAlerts } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const alerts = await getRecentAlerts(50);

  const supabase = await createClient();
  const { data: materials } = await supabase.from("materials").select("id, name, currency");
  const materialsById = new Map((materials ?? []).map((m) => [m.id, m]));

  const unread = alerts.filter((a) => !a.read_at).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {alerts.length === 0
              ? "Nothing raised yet."
              : `${alerts.length} in the last 50 · ${unread} unread`}
          </p>
        </div>
        {unread > 0 && (
          <form action={markAllAlertsRead}>
            <Button type="submit" variant="outline" size="sm">
              Mark all read
            </Button>
          </form>
        )}
      </header>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <BellOff className="size-6 text-muted-foreground" aria-hidden />
          <h2 className="font-medium">No alerts yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            The ingestion job raises an alert when a tracked material breaches
            its threshold, and Claude writes the summary of what drove it.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => {
            const material = materialsById.get(alert.material_id);
            const up = alert.kind === "spike";
            const Icon = up ? ArrowUpRight : ArrowDownRight;

            return (
              <li key={alert.id}>
                <Card className={cn(!alert.read_at && "border-sky-300 dark:border-sky-800")}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1.5">
                        <CardTitle className="flex items-center gap-1.5 text-base">
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              up
                                ? "text-rose-700 dark:text-rose-400"
                                : "text-emerald-700 dark:text-emerald-400",
                            )}
                            aria-hidden
                          />
                          {alert.headline}
                        </CardTitle>
                        <CardDescription>
                          {material?.name ?? "Material"} ·{" "}
                          {formatCurrency(
                            Number(alert.price_before),
                            material?.currency ?? "USD",
                            4,
                          )}{" "}
                          →{" "}
                          {formatCurrency(
                            Number(alert.price_after),
                            material?.currency ?? "USD",
                            4,
                          )}{" "}
                          over {alert.window_days} days
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {!alert.read_at && <Badge variant="secondary">new</Badge>}
                        <Badge variant="outline" className="tabular-nums">
                          {Number(alert.pct_change) > 0 ? "+" : ""}
                          {Number(alert.pct_change).toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <p className="text-sm">{alert.body}</p>

                    {alert.drivers?.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase">
                          Drivers
                        </p>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          {alert.drivers.map((driver, index) => (
                            <li key={index} className="flex gap-2">
                              <span aria-hidden>·</span>
                              <span>
                                <span className="font-medium text-foreground">
                                  {driver.driver}
                                </span>{" "}
                                — {driver.detail}
                                {driver.source && (
                                  <span className="text-xs"> ({driver.source})</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <Button
                      render={<Link href={`/materials/${alert.material_id}`} />}
                      variant="ghost"
                      size="sm"
                      className="-ml-2"
                    >
                      See the price history
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
