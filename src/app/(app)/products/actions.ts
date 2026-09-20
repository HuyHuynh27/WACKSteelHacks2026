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
  lines: z
    .array(bomLineSchema)
    .min(1, "Add at least one material.")
    // bom_items is unique on (product_id, material_id): two lines for the same
    // material would trip the constraint with an error nobody can act on.
    .refine(
      (lines) => new Set(lines.map((line) => line.material_id)).size === lines.length,
      "Each material can only appear once — combine the duplicate lines.",
    ),
});

/** Shared by create and update: pulls the form's fields into the schema. */
function parseProductForm(formData: FormData) {
  let lines: unknown = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { success: false, error: "Could not read the bill of materials." } as const;
  }

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku") ?? undefined,
    units_per_batch: formData.get("units_per_batch") ?? 1,
    lines,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message } as const;
  }
  return { success: true, data: parsed.data } as const;
}

export async function createProduct(formData: FormData): Promise<ActionState> {
  const parsed = parseProductForm(formData);
  if (!parsed.success) return { error: parsed.error };

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

export async function updateProduct(formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing product id." };

  const parsed = parseProductForm(formData);
  if (!parsed.success) return { error: parsed.error };

  const supabase = await createClient();
  const { name, sku, units_per_batch, lines } = parsed.data;

  const { error: productError } = await supabase
    .from("products")
    .update({ name, sku: sku?.trim() || null, units_per_batch })
    .eq("id", id);

  if (productError) return { error: productError.message };

  // Write the new recipe before pruning the old one, so a failure here leaves
  // the product costing itself from its previous bill of materials.
  const { error: bomError } = await supabase.from("bom_items").upsert(
    lines.map((line) => ({
      product_id: id,
      material_id: line.material_id,
      quantity: line.quantity,
      unit: line.unit,
    })),
    { onConflict: "product_id,material_id" },
  );

  if (bomError) return { error: bomError.message };

  const keep = lines.map((line) => line.material_id);
  const { error: pruneError } = await supabase
    .from("bom_items")
    .delete()
    .eq("product_id", id)
    .not("material_id", "in", `(${keep.join(",")})`);

  if (pruneError) return { error: pruneError.message };

  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { message: `Saved ${name}.` };
}

export async function deleteProduct(formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing product id." };

  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { message: "Product deleted." };
}
