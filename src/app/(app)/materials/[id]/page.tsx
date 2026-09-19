import { notFound } from "next/navigation";

import { PriceChart } from "@/components/charts/price-chart";
import { ManualPriceForm } from "@/components/manual-price-form";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { getMaterial, getMaterialStats, getPriceHistory } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await getMaterial(id);
  return { title: material?.name ?? "Material" };
}

export default async function MaterialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [material, stats, history] = await Promise.all([
    getMaterial(id),
    getMaterialStats(id),
    getPriceHistory(id),
  ]);
  if (!material) notFound();

  const supabase = await createClient();
  const [{ data: series }, { data: alerts }] = await Promise.all([
    material.fred_series_id
      ? supabase
          .from("fred_series")
          .select("*")
          .eq("series_id", material.fred_series_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("alerts")
      .select("*")
      .eq("material_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{material.name}</h1>
          {material.fred_series_id ? (
            <Badge variant="secondary" className="font-mono text-[11px]">
              {material.fred_series_id}
            </Badge>
          ) : (
            <Badge variant="outline">unmapped</Badge>
          )}
          {!material.tracking && <Badge variant="outline">paused</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            material.category,
            material.supplier,
            material.sku,
            `priced per ${material.unit}`,
            `alerts at ±${Number(material.alert_threshold_pct).toFixed(1)}%`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Latest tracked price"
          value={formatCurrency(stats?.latest_price, material.currency, 4)}
          hint={stats?.latest_observed_on ? `as of ${formatDate(stats.latest_observed_on)}` : undefined}
        />
        <StatTile
          label="Change, 7 days"
          value={formatCurrency(stats?.price_7d_ago, material.currency, 4)}
          delta={stats?.change_7d_pct ?? null}
          deltaLabel="vs a week ago"
        />
        <StatTile
          label="Change, 30 days"
          value={formatCurrency(stats?.price_30d_ago, material.currency, 4)}
          delta={stats?.change_30d_pct ?? null}
          deltaLabel="vs a month ago"
        />
        <StatTile
          label="Your baseline"
          value={formatCurrency(material.baseline_price, material.currency, 4)}
          hint="what you told us you pay"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {series?.title ?? material.name} price
            {series?.units ? ` (${series.units})` : ""}
          </CardTitle>
          <CardDescription>
            {series
              ? `FRED series ${series.series_id}${series.frequency ? `, ${series.frequency.toLowerCase()}` : ""}${
                  material.fred_confidence != null
                    ? ` · mapped with ${Math.round(Number(material.fred_confidence) * 100)}% confidence`
                    : ""
                }`
              : "Not yet mapped to a public price series."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PriceChart
            data={history.map((p) => ({
              observed_on: p.observed_on,
              price: Number(p.price),
            }))}
            currency={material.currency}
            unit={material.unit}
            baseline={material.baseline_price != null ? Number(material.baseline_price) : null}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Record what you paid</CardTitle>
            <CardDescription>
              Your own invoice prices sit alongside the tracked index, so you can
              see the spread between the market and your supplier.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ManualPriceForm materialId={material.id} currency={material.currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent alerts</CardTitle>
            <CardDescription>
              {alerts?.length
                ? "What moved, and why."
                : "No alerts for this material yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {alerts?.map((alert) => (
              <article key={alert.id} className="space-y-1.5 border-b pb-4 last:border-0 last:pb-0">
                <h3 className="text-sm font-medium">{alert.headline}</h3>
                <p className="text-sm text-muted-foreground">{alert.body}</p>
                {alert.drivers?.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {alert.drivers.map((driver, index) => (
                      <li key={index}>
                        <span className="font-medium text-foreground">{driver.driver}</span>{" "}
                        — {driver.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </CardContent>
        </Card>
      </div>

      {material.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-line text-muted-foreground">
              {material.notes}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
