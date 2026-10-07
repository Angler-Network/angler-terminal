import type { OrderSide } from "@/lib/venues/types";

/**
 * Swap card math: the user types the amount of the token they sell (the stablecoin on a buy, the asset on a sell);
 * trades are sized in USD underneath (`use-news-trader.ts`). Pure, unit-tested.
 */

/** USD size of a swap from the sold amount: a stablecoin counts at par, the asset at its price. */
export function swapSizeUsd(side: OrderSide, amount: number, assetPrice: number | undefined) {
  if (!(amount > 0)) return 0;
  if (side === "buy") return amount;
  return assetPrice && assetPrice > 0 ? amount * assetPrice : 0;
}

/** What the swap should return before a venue quote arrives: the price-based estimate. */
export function estimateReceive(side: OrderSide, amount: number, assetPrice: number | undefined) {
  if (!(amount > 0) || !assetPrice || !(assetPrice > 0)) return null;
  return side === "buy" ? amount / assetPrice : amount * assetPrice;
}

/** A share of a balance for the 25/50/75/Max buttons, rounded down so it never asks for more than is held. */
export function shareOf(balance: number, percent: number, decimals = 6) {
  if (!(balance > 0) || !(percent > 0)) return "";
  const step = 10 ** Math.min(decimals, 8);
  const value = Math.floor(((balance * Math.min(percent, 100)) / 100) * step) / step;
  return value > 0 ? String(value) : "";
}

/** Jupiter's names for pump.fun's two venues read better spelled out. */
const DEX_NAMES: Record<string, string> = { "Pump.fun": "Pump.fun bonding curve", "Pump.fun Amm": "PumpSwap" };

/** The DEXes a route goes through, for "via …" lines: "Raydium CLMM", "BisonFi → PumpSwap". */
export function routeText(labels: string[] | undefined) {
  return labels?.length ? labels.map((label) => DEX_NAMES[label] ?? label).join(" → ") : null;
}
