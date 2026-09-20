"use client";

import { useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { createMaterial, updateMaterial } from "@/app/(app)/materials/actions";
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

const UNITS = ["kg", "lb", "metric ton", "short ton", "L", "gal", "m", "ft", "m²", "unit"];

/** The editable slice of a material — everything the dialog can change. */
export type MaterialInit = {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  sku: string | null;
  supplier: string | null;
  currency: string;
  baseline_price: number | null;
  alert_threshold_pct: number;
};

/**
 * The field set, shared so add and edit can't drift apart. A unit outside
 * UNITS (set by an earlier version, or by hand) is added to the list rather
 * than silently reset to kg on the next save.
 */
function MaterialFields({ material }: { material?: MaterialInit }) {
  const units = material && !UNITS.includes(material.unit) ? [material.unit, ...UNITS] : UNITS;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="name">Material name</Label>
        <Input
          id="name"
          name="name"
          placeholder="6061 aluminium extrusion"
          defaultValue={material?.name}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Input
            id="category"
            name="category"
            placeholder="Metals"
            defaultValue={material?.category ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit">Unit of purchase</Label>
          <Select name="unit" defaultValue={material?.unit ?? "kg"}>
            <SelectTrigger id="unit" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="baseline_price">Price you pay</Label>
          <Input
            id="baseline_price"
            name="baseline_price"
            type="number"
            step="0.0001"
            min="0"
            placeholder="2.85"
            defaultValue={material?.baseline_price ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            name="currency"
            defaultValue={material?.currency ?? "USD"}
            maxLength={3}
            className="uppercase"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="alert_threshold_pct">Alert at ±%</Label>
          <Input
            id="alert_threshold_pct"
            name="alert_threshold_pct"
            type="number"
            step="0.5"
            min="0"
            defaultValue={material?.alert_threshold_pct ?? 5}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="supplier">Supplier</Label>
          <Input
            id="supplier"
            name="supplier"
            placeholder="Midwest Metals"
            defaultValue={material?.supplier ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sku">Your SKU</Label>
          <Input
            id="sku"
            name="sku"
            placeholder="AL-6061-EX"
            defaultValue={material?.sku ?? ""}
          />
        </div>
      </div>
    </>
  );
}

export function AddMaterialDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Called imperatively rather than through useActionState so the success path
  // can reset the form and close the dialog without a state-setting effect.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createMaterial(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      toast.success(result.message);
      formRef.current?.reset();
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" aria-hidden />
        Add material
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a raw material</DialogTitle>
          <DialogDescription>
            Name it the way your team does — the mapper matches it to a public
            price series on the next ingestion run.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <MaterialFields />

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add material"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditMaterialDialog({
  material,
  open,
  onOpenChange,
}: {
  material: MaterialInit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateMaterial(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      toast.success(result.message);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {material.name}</DialogTitle>
          <DialogDescription>
            Renaming a material re-runs the mapping on the next ingestion run;
            its recorded price history is kept either way.
          </DialogDescription>
        </DialogHeader>

        {/* Remounts on open so a cancelled edit doesn't linger in the fields. */}
        <form key={String(open)} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="id" value={material.id} />
          <MaterialFields material={material} />

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
