/** Compact USD for stat strips: $950, $12.3K, $4.56M, $1.23B. */
export function formatUsdCompact(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const [divisor, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const scaled = value / divisor;
  const digits = suffix === "" ? 0 : Math.abs(scaled) >= 100 ? 1 : 2;
  return `$${scaled.toFixed(digits)}${suffix}`;
}

/** Hyperliquid and Lighter both settle funding every hour; the shared table holds 8-hour rates. */
export function hourlyFundingPct(rate8h: number) {
  return (rate8h / 8) * 100;
}

/** Time left until the next funding payment (top of the hour, UTC), as mm:ss. */
export function fundingCountdown(now: number) {
  const left = Math.max(0, 3_600_000 - (now % 3_600_000));
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Signed percent with a fixed number of decimals, e.g. +0.0013% or -1.25%. */
export function signedPercent(value: number, decimals = 2) {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(decimals)}%`;
}

/** Slippage of an average fill against the mid, in percent, always positive when the fill is worse. */
export function slippagePct(side: "buy" | "sell", mid: number, avgPx: number) {
  if (!(mid > 0) || !(avgPx > 0)) return 0;
  return ((side === "buy" ? avgPx - mid : mid - avgPx) / mid) * 100;
}
