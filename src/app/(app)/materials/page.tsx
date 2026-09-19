import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleDashed } from "lucide-react";

import { AddMaterialDialog } from "@/components/material-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { getMaterialsWithStats } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Materials" };

function Delta({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const flat = Math.abs(value) < 0.05;
  const Icon = flat ? ArrowRight : value > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        flat
          ? "text-muted-foreground"
          : value > 0
            ? "text-rose-700 dark:text-rose-400"
            : "text-emerald-700 dark:text-emerald-400",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

export default async function MaterialsPage() {
  const materials = await getMaterialsWithStats();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Materials</h1>
          <p className="text-sm text-muted-foreground">
            {materials.length === 0
              ? "Nothing tracked yet."
              : `${materials.length} tracked · ${
                  materials.filter((m) => !m.fred_series_id).length
                } awaiting a price series`}
          </p>
        </div>
        <AddMaterialDialog />
      </header>

      {materials.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <h2 className="font-medium">Add the first thing you buy</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Start with your highest-spend input. Better RAW maps it to a public
            price series, backfills the history, and watches it from then on.
          </p>
          <AddMaterialDialog />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead className="hidden sm:table-cell">Series</TableHead>
                <TableHead className="text-right">Latest</TableHead>
                <TableHead className="text-right">7d</TableHead>
                <TableHead className="text-right">30d</TableHead>
                <TableHead className="hidden text-right md:table-cell">As of</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((material) => (
                <TableRow key={material.id}>
                  <TableCell>
                    <Link
                      href={`/materials/${material.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {material.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[material.category, material.supplier, `per ${material.unit}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    {material.fred_series_id ? (
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {material.fred_series_id}
                      </Badge>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CircleDashed className="size-3.5" aria-hidden />
                        unmapped
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(
                      material.stats?.latest_price ?? material.baseline_price,
                      material.currency,
                      4,
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Delta value={material.stats?.change_7d_pct ?? null} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Delta value={material.stats?.change_30d_pct ?? null} />
                  </TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground md:table-cell">
                    {formatDate(material.stats?.latest_observed_on)}
                  </TableCell>
                  <TableCell>
                    <Button
                      render={<Link href={`/materials/${material.id}`} />}
                      variant="ghost"
                      size="sm"
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
