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

export async function updateMaterial(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing material id." };

  const parsed = materialSchema.partial().safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const input = parsed.data;

  const { error } = await supabase
    .from("materials")
    .update({
      ...(input.name != null && { name: input.name }),
      ...(input.unit != null && { unit: input.unit }),
      category: blankToNull(input.category),
      sku: blankToNull(input.sku),
      supplier: blankToNull(input.supplier),
      notes: blankToNull(input.notes),
      ...(input.baseline_price !== undefined && { baseline_price: input.baseline_price }),
      ...(input.alert_threshold_pct != null && {
        alert_threshold_pct: input.alert_threshold_pct,
      }),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/materials");
  revalidatePath(`/materials/${id}`);
  return { message: "Saved." };
}

export async function deleteMaterial(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("materials").delete().eq("id", id);

  revalidatePath("/materials");
  revalidatePath("/dashboard");
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
