import { ProductForm } from "@/components/product-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatPercent } from "@/lib/format";
import { getMaterialsWithStats, getProductCosts } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const [costs, materials] = await Promise.all([
    getProductCosts(),
    getMaterialsWithStats(),
  ]);

  const supabase = await createClient();
  const { data: bom } = await supabase
    .from("bom_items")
    .select("id, product_id, material_id, quantity, unit");

  const bomByProduct = new Map<string, NonNullable<typeof bom>>();
  for (const item of bom ?? []) {
    bomByProduct.set(item.product_id, [...(bomByProduct.get(item.product_id) ?? []), item]);
  }
  const materialsById = new Map(materials.map((m) => [m.id, m]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            Attach materials to a product and its cost recalculates whenever the
            market moves.
          </p>
        </div>
        <ProductForm materials={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))} />
      </header>

      {costs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <h2 className="font-medium">No products yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            A product is a recipe: a list of materials and how much of each goes
            into one batch. Better RAW rolls the cost up from there.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {costs.map((product) => {
            const items = bomByProduct.get(product.product_id) ?? [];
            const then = product.unit_cost_30d_ago;
            const now = product.unit_cost;
            const delta =
              then != null && now != null && Number(then) !== 0
                ? ((Number(now) - Number(then)) / Number(then)) * 100
                : null;

            return (
              <Card key={product.product_id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <CardTitle>{product.name}</CardTitle>
                      <CardDescription>
                        {formatCurrency(
                          product.batch_cost != null ? Number(product.batch_cost) : null,
                        )}{" "}
                        per batch of {Number(product.units_per_batch)} ·{" "}
                        {product.material_count} materials
                        {product.unpriced_material_count > 0 &&
                          ` · ${product.unpriced_material_count} unpriced`}
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-semibold tabular-nums">
                        {formatCurrency(now != null ? Number(now) : null, "USD", 4)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        per unit{delta != null && ` · ${formatPercent(delta)} in 30d`}
                      </p>
                    </div>
                  </div>
                </CardHeader>

                {items.length > 0 && (
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Material</TableHead>
                          <TableHead className="text-right">Qty / batch</TableHead>
                          <TableHead className="text-right">Unit price</TableHead>
                          <TableHead className="text-right">Extended</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => {
                          const material = materialsById.get(item.material_id);
                          const price = material?.stats?.latest_price;
                          const extended =
                            price != null ? Number(price) * Number(item.quantity) : null;

                          return (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">
                                {material?.name ?? "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {Number(item.quantity)} {item.unit}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(
                                  price != null ? Number(price) : null,
                                  material?.currency,
                                  4,
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(extended, material?.currency, 2)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
