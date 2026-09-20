"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { deleteMaterial } from "@/app/(app)/materials/actions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EditMaterialDialog, type MaterialInit } from "@/components/material-form";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MaterialActions({
  material,
  /** From the material's own page there's nothing left to return to. */
  redirectOnDelete = false,
}: {
  material: MaterialInit;
  redirectOnDelete?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${material.name}`} />}
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

      <EditMaterialDialog material={material} open={editing} onOpenChange={setEditing} />

      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${material.name}?`}
        description="Its price history and alerts go with it. This can't be undone."
        onConfirm={async () => {
          const formData = new FormData();
          formData.set("id", material.id);
          const result = await deleteMaterial(formData);
          if (!result.error && redirectOnDelete) router.push("/materials");
          return result;
        }}
      />
    </>
  );
}
