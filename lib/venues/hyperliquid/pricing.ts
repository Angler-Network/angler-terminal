const PERP_MAX_DECIMALS = 6;
const SPOT_MAX_DECIMALS = 8;

function trimNumber(value: number, decimals: number) {
  return Number(value.toFixed(Math.max(0, decimals)));
}

/**
 * Hyperliquid price rule: at most 5 significant figures and at most (6 for perps, 8 for spot) - szDecimals
 * decimals; integer prices are always valid.
 */
export function roundPrice(price: number, szDecimals: number, isSpot = false) {
  if (!Number.isFinite(price) || price <= 0) throw new RangeError("Price must be a positive number");
  const decimals = (isSpot ? SPOT_MAX_DECIMALS : PERP_MAX_DECIMALS) - szDecimals;
  if (Number.isInteger(price)) return price;
  return trimNumber(Number(price.toPrecision(5)), decimals);
}

/**
 * Aggressive limit price for a market order (sent as IOC), following the official SDK's pattern:
 * mid * (1 ± slippage), then rounded to the price rule.
 */
export function slippagePrice(mid: number, isBuy: boolean, slippage: number, szDecimals: number, isSpot = false) {
  const raw = mid * (isBuy ? 1 + slippage : 1 - slippage);
  return roundPrice(raw, szDecimals, isSpot);
}

/** Truncates a base size to the market's lot size (szDecimals). */
export function roundSize(size: number, szDecimals: number) {
  const factor = 10 ** szDecimals;
  return Math.floor(size * factor + 1e-9) / factor;
}

/** Base size for a USD notional at a given price. */
export function sizeForNotional(usd: number, price: number, szDecimals: number) {
  if (!(usd > 0) || !(price > 0)) return 0;
  return roundSize(usd / price, szDecimals);
}

/** Wire format: plain decimal strings without exponent or trailing zeros. */
export function toWire(value: number) {
  const fixed = value.toFixed(10);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}
