const CURRENCY_CACHE = new Map<string, Intl.NumberFormat>();

export function formatCurrency(
  value: number | null | undefined,
  currency = "USD",
  maximumFractionDigits = 2,
) {
  if (value == null) return "—";
  const key = `${currency}:${maximumFractionDigits}`;
  let formatter = CURRENCY_CACHE.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits,
    });
    CURRENCY_CACHE.set(key, formatter);
  }
  return formatter.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Tailwind text colour for a signed change, neutral when flat or unknown. */
export function changeTone(value: number | null | undefined) {
  if (value == null || Math.abs(value) < 0.05) return "text-muted-foreground";
  return value > 0 ? "text-rose-600" : "text-emerald-600";
}
