"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

/**
 * 12-point trend for a stat tile. Decoration-free: no axes, no tooltip — the
 * tile's value and delta carry the numbers.
 */
export function Sparkline({
  data,
  tone = "neutral",
}: {
  data: number[];
  tone?: "up" | "down" | "neutral";
}) {
  if (data.length < 2) return <div className="h-8" />;

  const stroke =
    tone === "up"
      ? "var(--viz-up)"
      : tone === "down"
        ? "var(--viz-down)"
        : "var(--viz-deemphasis)";

  const points = data.slice(-12).map((value, index) => ({ index, value }));
  const gradientId = `spark-${tone}`;

  return (
    <div className="viz-root h-8 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
