"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { recordManualPrice, type ActionState } from "@/app/(app)/materials/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPTY: ActionState = {};

export function ManualPriceForm({
  materialId,
  currency,
}: {
  materialId: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(recordManualPrice, EMPTY);

  useEffect(() => {
    if (state.message) toast.success(state.message);
  }, [state.message]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="material_id" value={materialId} />

      <div className="space-y-2">
        <Label htmlFor="observed_on">Invoice date</Label>
        <Input id="observed_on" name="observed_on" type="date" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="price">Price ({currency})</Label>
        <Input
          id="price"
          name="price"
          type="number"
          step="0.0001"
          min="0"
          className="w-32"
          required
        />
      </div>

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Record"}
      </Button>

      {state.error && (
        <p className="w-full text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
