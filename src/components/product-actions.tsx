"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { deleteProduct } from "@/app/(app)/products/actions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import {
  EditProductDialog,
  type MaterialOption,
  type ProductInit,
} from "@/components/product-form";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ProductActions({
  product,
  materials,
}: {
  product: ProductInit;
  materials: MaterialOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${product.name}`} />}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditProductDialog
        product={product}
        materials={materials}
        open={editing}
        onOpenChange={setEditing}
      />

      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${product.name}?`}
        description="The bill of materials goes with it. The materials themselves stay tracked."
        onConfirm={async () => {
          const formData = new FormData();
          formData.set("id", product.id);
          return deleteProduct(formData);
        }}
      />
    </>
  );
}
