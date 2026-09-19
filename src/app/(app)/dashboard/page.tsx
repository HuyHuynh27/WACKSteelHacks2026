import Link from "next/link";
import { Bell } from "lucide-react";

import { MoversChart } from "@/components/charts/movers-chart";
import { AddMaterialDialog } from "@/components/material-form";
import { PushOptIn } from "@/components/pwa/push-opt-in";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/format";
import {
  getMaterialsWithStats,
  getNotificationPrefs,
  getProductCosts,
  getRecentAlerts,
} from "@/lib/queries";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [materials, products, alerts, prefs] = await Promise.all([
    getMaterialsWithStats(),
    getProductCosts(),
    getRecentAlerts(5),
    getNotificationPrefs(),
  ]);

  const priced = materials.filter((m) => m.stats?.change_30d_pct != null);
  const basketChange =
    priced.length > 0
      ? priced.reduce((sum, m) => sum + Number(m.stats!.change_30d_pct), 0) / priced.length
      : null;

  const movers = priced
    .map((m) => ({ name: m.name, changePct: Number(m.stats!.change_30d_pct) }))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 6);

  const biggestRise = movers.filter((m) => m.changePct > 0)[0] ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            What your inputs are doing, and what it means for your costs.
          </p>
        </div>
        <AddMaterialDialog />
      </header>

      {!prefs?.enabled && <PushOptIn />}

      {/* KPI row — headline numbers belong in stat tiles, not a bar chart. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Materials tracked"
          value={String(materials.length)}
          hint={`${materials.filter((m) => m.fred_series_id).length} mapped to a price series`}
        />
        <StatTile
          label="Input basket, 30 days"
          value={basketChange != null ? formatPercent(basketChange) : "—"}
          delta={basketChange}
          deltaLabel="average across mapped materials"
        />
        <StatTile
          label="Biggest rise"
          value={biggestRise?.name ?? "—"}
          delta={biggestRise?.changePct ?? null}
          deltaLabel="over 30 days"
        />
        <StatTile
          label="Products costed"
          value={String(products.length)}
          hint={
            products.some((p) => p.unpriced_material_count > 0)
              ? "some materials still unpriced"
              : "all inputs priced"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Biggest movers, last 30 days</CardTitle>
            <CardDescription>
              Percentage change against the price 30 days ago. Rises push your
              cost of goods up; falls are margin back in your pocket.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MoversChart data={movers} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle>Latest alerts</CardTitle>
              <CardDescription>Price moves worth your attention.</CardDescription>
            </div>
            <Button render={<Link href="/alerts" />} variant="ghost" size="sm">
              All
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Bell className="size-5 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  No alerts yet. The ingestion job raises one when a tracked
                  material breaches its threshold.
                </p>
              </div>
            ) : (
              alerts.map((alert) => (
                <Link
                  key={alert.id}
                  href={`/materials/${alert.material_id}`}
                  className="block space-y-1 border-b pb-3 last:border-0 last:pb-0"
                >
                  <p className="text-sm font-medium">{alert.headline}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{alert.body}</p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {products.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Product cost roll-up</CardTitle>
            <CardDescription>
              Unit cost at the latest tracked prices, against 30 days ago.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {products.map((product) => {
              const then = product.unit_cost_30d_ago;
              const now = product.unit_cost;
              const delta =
                then != null && now != null && Number(then) !== 0
                  ? ((Number(now) - Number(then)) / Number(then)) * 100
                  : null;

              return (
                <div
                  key={product.product_id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.material_count} materials
                      {product.unpriced_material_count > 0 &&
                        ` · ${product.unpriced_material_count} unpriced`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {formatCurrency(now != null ? Number(now) : null, "USD", 4)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {delta != null ? `${formatPercent(delta)} in 30d` : "no history"}
                    </p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
