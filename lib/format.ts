import type { Translate } from "@/lib/i18n/types";

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const smallPriceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumSignificantDigits: 2,
  maximumSignificantDigits: 4,
});

export function formatPrice(value: number): string {
  return Math.abs(value) < 1 ? smallPriceFormatter.format(value) : priceFormatter.format(value);
}

export function formatPercent(value: number): string {
  return `${Math.abs(value).toFixed(2)}%`;
}

export function formatRelativeTime(minutesAgo: number, t: Translate): string {
  if (minutesAgo <= 0) return t("time.now");
  if (minutesAgo < 60) return t("time.minutes", { n: minutesAgo });
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return t("time.hours", { n: hours });
  return t("time.days", { n: Math.floor(hours / 24) });
}
