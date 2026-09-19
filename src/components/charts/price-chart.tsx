"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PricePoint = { observed_on: string; price: number };

const RANGES = [
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 365 * 5 },
  { label: "All", days: Number.POSITIVE_INFINITY },
] as const;

function tickDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function ChartTooltip({
  active,
  payload,
  currency,
  unit,
}: {
  active?: boolean;
  payload?: { payload: PricePoint }[];
  currency: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">
        {new Date(`${point.observed_on}T00:00:00Z`).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })}
      </p>
      <p className="mt-1 flex items-center gap-1.5 font-medium tabular-nums">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: "var(--viz-series-1)" }}
          aria-hidden
        />
        {formatCurrency(point.price, currency, 4)}
        <span className="font-normal text-muted-foreground">/ {unit}</span>
      </p>
    </div>
  );
}

/**
 * Trend over time, one series — so: line/area with a sequential hue, no legend
 * (the card title names what is plotted) and a direct label on the last point.
 */
export function PriceChart({
  data,
  currency = "USD",
  unit = "unit",
  baseline,
}: {
  data: PricePoint[];
  currency?: string;
  unit?: string;
  baseline?: number | null;
}) {
  const [rangeIndex, setRangeIndex] = useState(1);

  const visible = useMemo(() => {
    const { days } = RANGES[rangeIndex];
    if (!Number.isFinite(days) || data.length === 0) return data;
    const newest = new Date(`${data[data.length - 1].observed_on}T00:00:00Z`);
    const cutoff = new Date(newest);
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    return data.filter((d) => new Date(`${d.observed_on}T00:00:00Z`) >= cutoff);
  }, [data, rangeIndex]);

  if (data.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-center">
        <p className="text-sm font-medium">No price history yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Once this material is mapped to a price series, the daily ingestion job
          will backfill its history.
        </p>
      </div>
    );
  }

  const last = visible[visible.length - 1];

  return (
    <div className="viz-root space-y-3">
      <div className="flex items-center justify-end gap-1">
        {RANGES.map((range, index) => (
          <Button
            key={range.label}
            size="sm"
            variant={index === rangeIndex ? "secondary" : "ghost"}
            className={cn("h-7 px-2.5 text-xs", index === rangeIndex && "font-medium")}
            onClick={() => setRangeIndex(index)}
            aria-pressed={index === rangeIndex}
          >
            {range.label}
          </Button>
        ))}
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={visible} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <defs>
              {/* Area is a ~10% wash of the series hue, never a saturated block. */}
              <linearGradient id="priceWash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />

            <XAxis
              dataKey="observed_on"
              tickFormatter={tickDate}
              tick={{ fill: "var(--viz-muted)", fontSize: 11 }}
              stroke="var(--viz-axis)"
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "var(--viz-muted)", fontSize: 11 }}
              stroke="var(--viz-axis)"
              tickLine={false}
              axisLine={false}
              width={62}
              domain={["auto", "auto"]}
              tickFormatter={(value: number) => formatCurrency(value, currency, 0)}
            />

            {baseline != null && (
              <ReferenceLine
                y={baseline}
                stroke="var(--viz-deemphasis)"
                strokeDasharray="4 4"
                label={{
                  value: "your baseline",
                  position: "insideTopLeft",
                  fill: "var(--viz-muted)",
                  fontSize: 10,
                }}
              />
            )}

            <Tooltip
              content={<ChartTooltip currency={currency} unit={unit} />}
              cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
            />

            <Area
              type="monotone"
              dataKey="price"
              stroke="var(--viz-series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="url(#priceWash)"
              // No dot per point; only the endpoint is marked, with a 2px
              // surface ring so it stays legible over the line.
              dot={false}
              activeDot={{
                r: 4,
                fill: "var(--viz-series-1)",
                stroke: "var(--viz-surface)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {last && (
        <p className="text-right text-xs text-muted-foreground">
          Latest{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCurrency(last.price, currency, 4)}
          </span>{" "}
          on {tickDate(last.observed_on)} · {visible.length} observations
        </p>
      )}
    </div>
  );
}
