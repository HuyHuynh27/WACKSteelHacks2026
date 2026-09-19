"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type Mover = {
  name: string;
  changePct: number;
};

function MoverTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Mover }[];
}) {
  if (!active || !payload?.length) return null;
  const mover = payload[0].payload;
  const up = mover.changePct > 0;

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{mover.name}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: up ? "var(--viz-up)" : "var(--viz-down)" }}
          aria-hidden
        />
        <span className="tabular-nums">
          {up ? "+" : ""}
          {mover.changePct.toFixed(1)}%
        </span>
        <span>over 30 days · {up ? "costing you more" : "costing you less"}</span>
      </p>
    </div>
  );
}

/**
 * Change against a zero baseline — a polarity job, so a diverging bar with the
 * validated blue↔red pair. Red is a price rise (bad for an input cost); blue is
 * a fall. Direct value labels ride the bar ends so the sign never depends on
 * colour alone.
 */
export function MoversChart({ data }: { data: Mover[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-center">
        <p className="text-sm font-medium">Nothing has moved yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Movers appear once there are at least 30 days of price history.
        </p>
      </div>
    );
  }

  const ordered = [...data].sort((a, b) => b.changePct - a.changePct);
  const bound = Math.max(5, ...ordered.map((d) => Math.abs(d.changePct))) * 1.35;

  return (
    <div className="viz-root w-full" style={{ height: Math.max(180, ordered.length * 34) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={ordered}
          layout="vertical"
          margin={{ top: 4, right: 44, bottom: 4, left: 4 }}
          barCategoryGap="28%"
        >
          <XAxis type="number" domain={[-bound, bound]} hide />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "var(--viz-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={112}
          />
          <ReferenceLine x={0} stroke="var(--viz-axis)" strokeWidth={1} />
          <Tooltip content={<MoverTooltip />} cursor={{ fill: "var(--viz-neutral)" }} />

          <Bar
            dataKey="changePct"
            barSize={16}
            radius={[4, 4, 4, 4]}
            isAnimationActive={false}
          >
            {ordered.map((mover) => (
              <Cell
                key={mover.name}
                fill={mover.changePct > 0 ? "var(--viz-up)" : "var(--viz-down)"}
              />
            ))}
            <LabelList
              dataKey="changePct"
              position="right"
              className="fill-muted-foreground"
              style={{ fontSize: 11 }}
              formatter={(value) => {
                const pct = Number(value);
                return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
