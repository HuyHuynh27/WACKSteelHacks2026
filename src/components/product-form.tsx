"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { createProduct, updateProduct } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type MaterialOption = { id: string; name: string; unit: string };

/** The editable slice of a product, recipe included. */
export type ProductInit = {
  id: string;
  name: string;
  sku: string | null;
  units_per_batch: number;
  lines: { materialId: string; quantity: string }[];
};

type Line = { materialId: string; quantity: string };

const BLANK_LINE: Line = { materialId: "", quantity: "" };

/**
 * The recipe editor, shared by add and edit. The bill of materials is React
 * state rather than form fields, so it rides along as a JSON payload.
 */
function ProductFields({
  materials,
  product,
  submitLabel,
  pendingLabel,
  onCancel,
  onSubmitted,
}: {
  materials: MaterialOption[];
  product?: ProductInit;
  submitLabel: string;
  pendingLabel: string;
  onCancel?: () => void;
  onSubmitted: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(
    product?.lines.length ? product.lines : [BLANK_LINE],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Called imperatively rather than through useActionState so the success path
  // can reset the recipe and close the dialog without a state-setting effect.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = product
        ? await updateProduct(formData)
        : await createProduct(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      toast.success(result.message);
      if (!product) {
        formRef.current?.reset();
        setLines([BLANK_LINE]);
      }
      onSubmitted();
    });
  }

  const unitFor = (materialId: string) =>
    materials.find((m) => m.id === materialId)?.unit ?? "unit";

  const payload = JSON.stringify(
    lines
      .filter((line) => line.materialId && line.quantity)
      .map((line) => ({
        material_id: line.materialId,
        quantity: Number(line.quantity),
        unit: unitFor(line.materialId),
      })),
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="lines" value={payload} />
      {product && <input type="hidden" name="id" value={product.id} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="name">Product name</Label>
          <Input
            id="name"
            name="name"
            placeholder="Model B bracket"
            defaultValue={product?.name}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sku">SKU</Label>
          <Input
            id="sku"
            name="sku"
            placeholder="BRK-B"
            defaultValue={product?.sku ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="units_per_batch">Units per batch</Label>
          <Input
            id="units_per_batch"
            name="units_per_batch"
            type="number"
            min="1"
            step="1"
            defaultValue={product?.units_per_batch ?? 1}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Bill of materials</Label>
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={line.materialId}
                onValueChange={(value) =>
                  setLines((prev) =>
                    prev.map((l, i) =>
                      i === index ? { ...l, materialId: value ?? "" } : l,
                    ),
                  )
                }
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Choose a material" />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="number"
                step="0.0001"
                min="0"
                placeholder="Qty"
                className="w-24"
                value={line.quantity}
                onChange={(event) =>
                  setLines((prev) =>
                    prev.map((l, i) =>
                      i === index ? { ...l, quantity: event.target.value } : l,
                    ),
                  )
                }
              />

              <span className="w-16 text-xs text-muted-foreground">
                {line.materialId ? unitFor(line.materialId) : ""}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove line"
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLines((prev) => [...prev, BLANK_LINE])}
        >
          <Plus className="size-4" aria-hidden />
          Add line
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProductForm({ materials }: { materials: MaterialOption[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" disabled={materials.length === 0} />}>
        <Plus className="size-4" aria-hidden />
        Add product
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a product</DialogTitle>
          <DialogDescription>
            List the materials that go into one batch. Cost rolls up from the
            latest tracked prices.
          </DialogDescription>
        </DialogHeader>

        <ProductFields
          materials={materials}
          submitLabel="Add product"
          pendingLabel="Adding…"
          onSubmitted={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditProductDialog({
  product,
  materials,
  open,
  onOpenChange,
}: {
  product: ProductInit;
  materials: MaterialOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {product.name}</DialogTitle>
          <DialogDescription>
            Change the recipe and the unit cost recalculates from the latest
            prices.
          </DialogDescription>
        </DialogHeader>

        {/* Remounts on open so a cancelled edit doesn't linger in the recipe. */}
        <ProductFields
          key={String(open)}
          materials={materials}
          product={product}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          onCancel={() => onOpenChange(false)}
          onSubmitted={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
