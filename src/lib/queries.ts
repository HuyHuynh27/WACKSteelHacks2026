import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  Alert,
  Material,
  MaterialPriceStats,
  PricePoint,
  ProductCost,
} from "@/lib/database.types";

export type MaterialWithStats = Material & {
  stats: MaterialPriceStats | null;
};

/** Every material for the signed-in business, joined to its price stats. */
export async function getMaterialsWithStats(): Promise<MaterialWithStats[]> {
  const supabase = await createClient();

  const [{ data: materials }, { data: stats }] = await Promise.all([
    supabase.from("materials").select("*").order("name"),
    supabase.from("material_price_stats").select("*"),
  ]);

  const statsById = new Map((stats ?? []).map((s) => [s.material_id, s]));
  return (materials ?? []).map((material) => ({
    ...material,
    stats: statsById.get(material.id) ?? null,
  }));
}

export async function getMaterial(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("materials").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function getPriceHistory(materialId: string, limit = 400): Promise<PricePoint[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("price_points")
    .select("*")
    .eq("material_id", materialId)
    .order("observed_on", { ascending: true })
    .limit(limit);
  return data ?? [];
}

export async function getMaterialStats(materialId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_price_stats")
    .select("*")
    .eq("material_id", materialId)
    .maybeSingle();
  return data;
}

export async function getRecentAlerts(limit = 25): Promise<Alert[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getProductCosts(): Promise<ProductCost[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("product_costs").select("*").order("name");
  return data ?? [];
}

export async function getNotificationPrefs() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("notification_prefs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
}
