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

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
/** Below this a price's zeros are counted, not written out. */
const TINY_PRICE = 0.0001;

export function formatPrice(value: number): string {
  // Zero has no significant digits: the small-price formatter would print "$0.0".
  if (value !== 0 && Math.abs(value) < TINY_PRICE) return formatTinyPrice(value);
  return Math.abs(value) < 1 && value !== 0 ? smallPriceFormatter.format(value) : priceFormatter.format(value);
}

/**
 * A memecoin price like 0.0000000000000246 as "$0.0₁₃246" (the zeros after "0.0" counted in subscript, as DEX screens
 * do), so it fits a table column instead of running into the next one.
 */
function formatTinyPrice(value: number) {
  const [mantissa, exponent] = Math.abs(value).toExponential(3).split("e");
  const digits = mantissa.replace(".", "").replace(/0+$/, "") || "0";
  const zeros = -Number(exponent) - 1;
  const count = [...String(zeros)].map((digit) => SUBSCRIPT[Number(digit)]).join("");
  return `${value < 0 ? "-" : ""}$0.0${count}${digits}`;
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
