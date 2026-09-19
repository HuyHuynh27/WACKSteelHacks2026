/**
 * Hand-maintained mirror of supabase/migrations/*.sql.
 *
 * Once the project is linked you can regenerate this instead:
 *   npx supabase gen types typescript --linked > src/lib/database.types.ts
 */

export type PriceSource = "fred" | "manual" | "supplier";
export type AlertKind = "spike" | "dip";
export type DigestFrequency = "instant" | "daily" | "weekly";

export type AlertDriver = {
  driver: string;
  detail: string;
  source?: string | null;
};

type Row<T> = T;
type Insert<T, Optional extends keyof T> = Omit<T, Optional> &
  Partial<Pick<T, Optional>>;

export type Profile = {
  id: string;
  company_name: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type FredSeries = {
  series_id: string;
  title: string;
  units: string | null;
  frequency: string | null;
  keywords: string[];
  created_at: string;
};

export type Material = {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  unit: string;
  sku: string | null;
  supplier: string | null;
  notes: string | null;
  currency: string;
  baseline_price: number | null;
  fred_series_id: string | null;
  fred_confidence: number | null;
  fred_mapped_at: string | null;
  tracking: boolean;
  alert_threshold_pct: number;
  created_at: string;
  updated_at: string;
};

export type PricePoint = {
  id: number;
  material_id: string;
  observed_on: string;
  price: number;
  currency: string;
  source: PriceSource;
  created_at: string;
};

export type Product = {
  id: string;
  user_id: string;
  name: string;
  sku: string | null;
  units_per_batch: number;
  created_at: string;
  updated_at: string;
};

export type BomItem = {
  id: string;
  product_id: string;
  material_id: string;
  quantity: number;
  unit: string;
  created_at: string;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type NotificationPrefs = {
  user_id: string;
  enabled: boolean;
  min_change_pct: number;
  digest: DigestFrequency;
  quiet_hours_start: number;
  quiet_hours_end: number;
  updated_at: string;
};

export type Alert = {
  id: string;
  user_id: string;
  material_id: string;
  kind: AlertKind;
  window_days: number;
  pct_change: number;
  price_before: number;
  price_after: number;
  headline: string;
  body: string;
  drivers: AlertDriver[];
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

export type MaterialPriceStats = {
  material_id: string;
  user_id: string;
  name: string;
  unit: string;
  currency: string;
  latest_price: number | null;
  latest_observed_on: string | null;
  price_7d_ago: number | null;
  price_30d_ago: number | null;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
};

export type ProductCost = {
  product_id: string;
  user_id: string;
  name: string;
  units_per_batch: number;
  material_count: number;
  unpriced_material_count: number;
  batch_cost: number | null;
  unit_cost: number | null;
  unit_cost_30d_ago: number | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Row<Profile>;
        Insert: Insert<Profile, "company_name" | "timezone" | "created_at" | "updated_at">;
        Update: Partial<Profile>;
        Relationships: [];
      };
      fred_series: {
        Row: Row<FredSeries>;
        Insert: Insert<FredSeries, "units" | "frequency" | "keywords" | "created_at">;
        Update: Partial<FredSeries>;
        Relationships: [];
      };
      materials: {
        Row: Row<Material>;
        Insert: Insert<
          Material,
          | "id"
          | "category"
          | "unit"
          | "sku"
          | "supplier"
          | "notes"
          | "currency"
          | "baseline_price"
          | "fred_series_id"
          | "fred_confidence"
          | "fred_mapped_at"
          | "tracking"
          | "alert_threshold_pct"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<Material>;
        Relationships: [];
      };
      price_points: {
        Row: Row<PricePoint>;
        Insert: Insert<PricePoint, "id" | "currency" | "source" | "created_at">;
        Update: Partial<PricePoint>;
        Relationships: [];
      };
      products: {
        Row: Row<Product>;
        Insert: Insert<Product, "id" | "sku" | "units_per_batch" | "created_at" | "updated_at">;
        Update: Partial<Product>;
        Relationships: [];
      };
      bom_items: {
        Row: Row<BomItem>;
        Insert: Insert<BomItem, "id" | "unit" | "created_at">;
        Update: Partial<BomItem>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: Row<PushSubscriptionRow>;
        Insert: Insert<PushSubscriptionRow, "id" | "user_agent" | "created_at" | "last_used_at">;
        Update: Partial<PushSubscriptionRow>;
        Relationships: [];
      };
      notification_prefs: {
        Row: Row<NotificationPrefs>;
        Insert: Insert<
          NotificationPrefs,
          "enabled" | "min_change_pct" | "digest" | "quiet_hours_start" | "quiet_hours_end" | "updated_at"
        >;
        Update: Partial<NotificationPrefs>;
        Relationships: [];
      };
      alerts: {
        Row: Row<Alert>;
        Insert: Insert<
          Alert,
          "id" | "window_days" | "drivers" | "created_at" | "delivered_at" | "read_at"
        >;
        Update: Partial<Alert>;
        Relationships: [];
      };
    };
    Views: {
      material_price_stats: { Row: Row<MaterialPriceStats>; Relationships: [] };
      product_costs: { Row: Row<ProductCost>; Relationships: [] };
    };
    Functions: Record<string, never>;
    Enums: {
      price_source: PriceSource;
    };
    CompositeTypes: Record<string, never>;
  };
};
