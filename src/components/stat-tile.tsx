import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { Sparkline } from "@/components/charts/sparkline";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * label · value · delta (signed, vs a named period) · optional sparkline.
 *
 * For input costs, up is bad — so the delta pairs its colour with an arrow icon
 * and an explicit sign, never colour alone.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood = false,
  trend,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  upIsGood?: boolean;
  trend?: number[];
  hint?: string;
}) {
  const flat = delta == null || Math.abs(delta) < 0.05;
  const good = delta != null && (upIsGood ? delta > 0 : delta < 0);
  const Icon = flat ? ArrowRight : delta! > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="gap-0 py-4">
      <CardContent className="space-y-2 px-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>

        {delta != null && (
          <p
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              flat
                ? "text-muted-foreground"
                : good
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400",
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="tabular-nums">
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}%
            </span>
            {deltaLabel && <span className="font-normal text-muted-foreground">{deltaLabel}</span>}
          </p>
        )}

        {hint && !delta && <p className="text-xs text-muted-foreground">{hint}</p>}

        {trend && trend.length > 1 && (
          <Sparkline data={trend} tone={flat ? "neutral" : delta! > 0 ? "up" : "down"} />
        )}
      </CardContent>
    </Card>
  );
}
