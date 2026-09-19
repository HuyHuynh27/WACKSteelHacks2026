"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const bomLineSchema = z.object({
  material_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  unit: z.string().min(1),
});

const productSchema = z.object({
  name: z.string().trim().min(1, "Give the product a name."),
  sku: z.string().trim().optional(),
  units_per_batch: z.coerce.number().positive().default(1),
  lines: z.array(bomLineSchema).min(1, "Add at least one material."),
});

export async function createProduct(formData: FormData): Promise<ActionState> {
  const rawLines = formData.get("lines");
  let lines: unknown = [];
  try {
    lines = JSON.parse(String(rawLines ?? "[]"));
  } catch {
    return { error: "Could not read the bill of materials." };
  }

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku") ?? undefined,
    units_per_batch: formData.get("units_per_batch") ?? 1,
    lines,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: product, error: productError } = await supabase
    .from("products")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      sku: parsed.data.sku?.trim() || null,
      units_per_batch: parsed.data.units_per_batch,
    })
    .select("id")
    .single();

  if (productError || !product) {
    return { error: productError?.message ?? "Could not create the product." };
  }

  const { error: bomError } = await supabase.from("bom_items").insert(
    parsed.data.lines.map((line) => ({
      product_id: product.id,
      material_id: line.material_id,
      quantity: line.quantity,
      unit: line.unit,
    })),
  );

  if (bomError) {
    // Don't leave a product with a half-written recipe.
    await supabase.from("products").delete().eq("id", product.id);
    return { error: bomError.message };
  }

  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { message: `Added ${parsed.data.name}.` };
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", id);

  revalidatePath("/products");
  revalidatePath("/dashboard");
}
