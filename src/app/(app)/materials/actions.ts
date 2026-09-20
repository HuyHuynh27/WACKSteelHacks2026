"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const numeric = z
  .union([z.string(), z.number()])
  .transform((v) => (v === "" || v == null ? null : Number(v)))
  .refine((v) => v == null || Number.isFinite(v), "Must be a number");

const materialSchema = z.object({
  name: z.string().trim().min(1, "Give the material a name."),
  category: z.string().trim().optional(),
  unit: z.string().trim().min(1).default("kg"),
  sku: z.string().trim().optional(),
  supplier: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  currency: z.string().trim().length(3).default("USD"),
  baseline_price: numeric.optional(),
  alert_threshold_pct: numeric.optional(),
});

function blankToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createMaterial(formData: FormData): Promise<ActionState> {
  const parsed = materialSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const input = parsed.data;
  const { error } = await supabase.from("materials").insert({
    user_id: user.id,
    name: input.name,
    category: blankToNull(input.category),
    unit: input.unit,
    sku: blankToNull(input.sku),
    supplier: blankToNull(input.supplier),
    notes: blankToNull(input.notes),
    currency: input.currency.toUpperCase(),
    baseline_price: input.baseline_price ?? null,
    alert_threshold_pct: input.alert_threshold_pct ?? 5,
  });

  if (error) {
    // materials_user_name_key
    if (error.code === "23505") {
      return { error: `You already track a material called "${input.name}".` };
    }
    return { error: error.message };
  }

  revalidatePath("/materials");
  revalidatePath("/dashboard");
  return {
    message: `Added ${input.name}. The next ingestion run will map it to a price series.`,
  };
}

export async function updateMaterial(formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing material id." };

  const parsed = materialSchema.partial().safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const input = parsed.data;

  // Two fields invalidate the mapping, and both do it silently.
  //
  // `price_factor` was derived from the old unit: FRED quotes aluminum per
  // metric ton and the factor converts that to pounds. Switch the unit to
  // kilograms and the stored prices stay per-pound while the UI relabels them,
  // so every BOM cost lands 2.2x out with nothing to show it.
  //
  // The series itself was chosen from the old name, and the worker only picks
  // up materials where `fred_series_id` is null — so a rename would otherwise
  // keep tracking whatever the previous name matched, forever.
  //
  // In both cases: clear the mapping, reset the conversion, and drop the FRED
  // history that was converted under the old assumptions. The next ingestion
  // run re-maps and re-backfills. Manually recorded prices are the buyer's own
  // records and are left alone.
  const { data: current } = await supabase
    .from("materials")
    .select("name, unit")
    .eq("id", id)
    .maybeSingle();

  const unitChanged = input.unit != null && current != null && input.unit !== current.unit;
  const nameChanged = input.name != null && current != null && input.name !== current.name;
  const remap = unitChanged || nameChanged;

  // Only touch the nullable columns the form actually submitted — otherwise a
  // field the dialog doesn't render (notes) would be blanked on every save.
  const clearable = <T,>(field: string, value: T) =>
    formData.has(field) ? { [field]: value } : {};

  const { error } = await supabase
    .from("materials")
    .update({
      ...(input.name != null && { name: input.name }),
      ...(input.unit != null && { unit: input.unit }),
      ...(input.currency != null && { currency: input.currency.toUpperCase() }),
      ...clearable("category", blankToNull(input.category)),
      ...clearable("sku", blankToNull(input.sku)),
      ...clearable("supplier", blankToNull(input.supplier)),
      ...clearable("notes", blankToNull(input.notes)),
      ...(input.baseline_price !== undefined && { baseline_price: input.baseline_price }),
      ...(input.alert_threshold_pct != null && {
        alert_threshold_pct: input.alert_threshold_pct,
      }),
      ...(remap && {
        fred_series_id: null,
        fred_confidence: null,
        fred_mapped_at: null,
        price_factor: 1,
        price_native_unit: null,
        price_is_index: false,
      }),
    })
    .eq("id", id);

  if (error) {
    // materials_user_name_key
    if (error.code === "23505") {
      return { error: `You already track a material called "${input.name}".` };
    }
    return { error: error.message };
  }

  if (remap) {
    // Prices converted under the old unit would sit in the same series as
    // prices converted under the new one, which reads as a cliff in the chart
    // and would trip the alert detector.
    await supabase.from("price_points").delete().eq("material_id", id).eq("source", "fred");
  }

  revalidatePath("/materials");
  revalidatePath(`/materials/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/products");

  return {
    message: remap
      ? `Saved. ${
          unitChanged ? "Changing the unit" : "Renaming"
        } clears the price series — the next ingestion run re-maps it and backfills the history.`
      : "Saved.",
  };
}

/** Names the products whose bill of materials still references a material. */
async function productsUsing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  materialId: string,
): Promise<string[]> {
  const { data: lines } = await supabase
    .from("bom_items")
    .select("product_id")
    .eq("material_id", materialId);

  const productIds = [...new Set((lines ?? []).map((line) => line.product_id))];
  if (productIds.length === 0) return [];

  const { data: products } = await supabase
    .from("products")
    .select("name")
    .in("id", productIds);

  return (products ?? []).map((product) => product.name);
}

export async function deleteMaterial(formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing material id." };

  const supabase = await createClient();
  const { error } = await supabase.from("materials").delete().eq("id", id);

  if (error) {
    // bom_items.material_id is ON DELETE RESTRICT — a material can't vanish
    // out from under a product that still costs itself from it.
    if (error.code === "23503") {
      const names = await productsUsing(supabase, id);
      return {
        error: names.length
          ? `Still used by ${names.join(", ")}. Remove it from ${
              names.length === 1 ? "that product" : "those products"
            } first.`
          : "This material is still used by a product. Remove it there first.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/materials");
  revalidatePath("/dashboard");
  return { message: "Material deleted." };
}

export async function toggleTracking(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const tracking = formData.get("tracking") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("materials").update({ tracking: !tracking }).eq("id", id);

  revalidatePath("/materials");
}

const manualPriceSchema = z.object({
  material_id: z.string().uuid(),
  observed_on: z.string().min(1),
  price: numeric,
});

/** Lets a business record what they actually paid, alongside the tracked index. */
export async function recordManualPrice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = manualPriceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a date and a price." };

  const { material_id, observed_on, price } = parsed.data;
  if (price == null) return { error: "Enter a price." };

  const supabase = await createClient();
  const { error } = await supabase.from("price_points").upsert(
    { material_id, observed_on, price, source: "manual" },
    { onConflict: "material_id,observed_on,source" },
  );

  if (error) return { error: error.message };

  revalidatePath(`/materials/${material_id}`);
  return { message: "Price recorded." };
}