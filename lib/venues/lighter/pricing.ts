import type { VenueMarket } from "../types";

/** Signer limits (lighter-go types/txtypes/constants.go). */
export const MAX_ORDER_PRICE = 2 ** 32 - 1;
export const MAX_BASE_AMOUNT = 2 ** 48 - 1;
export const MAX_CLIENT_ORDER_INDEX = 2 ** 48 - 1;

/** Scales a decimal to Lighter's integer units, rounding as asked. Works around float noise (0.29 * 100). */
export function toUnits(value: number, decimals: number, rounding: "floor" | "ceil" | "round" = "round") {
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Amount must be a non-negative number");
  const scaled = value * 10 ** decimals;
  const nearest = Math.round(scaled);
  // Within float noise of an integer: take it as is, whatever the rounding.
  if (Math.abs(scaled - nearest) < 1e-6) return nearest;
  return rounding === "floor" ? Math.floor(scaled) : rounding === "ceil" ? Math.ceil(scaled) : nearest;
}

export function fromUnits(units: number, decimals: number) {
  return units / 10 ** decimals;
}

/** Base amount integer for a size, truncated to the market's size decimals. */
export function baseAmountFor(size: number, sizeDecimals: number) {
  const units = toUnits(size, sizeDecimals, "floor");
  if (units > MAX_BASE_AMOUNT) throw new RangeError("Size is too large");
  return units;
}

/**
 * Worst acceptable price for a market (IOC) order: the reference price moved by `slippage` against the order,
 * rounded away from the market (up for buys, down for sells) to the price decimals.
 */
export function worstPrice(reference: number, isBuy: boolean, slippage: number, priceDecimals: number) {
  if (!(reference > 0)) throw new RangeError("Reference price must be positive");
  const raw = reference * (isBuy ? 1 + slippage : 1 - slippage);
  const units = toUnits(raw, priceDecimals, isBuy ? "ceil" : "floor");
  if (units < 1) throw new RangeError("Price rounds to zero");
  if (units > MAX_ORDER_PRICE) throw new RangeError("Price is too large for this market");
  return units;
}

/** The smallest size an opening order may have: the larger of the base minimum and the quote minimum at `price`. */
export function minimumSize(market: Pick<VenueMarket, "szDecimals" | "minBaseAmount" | "minQuoteAmount">, price: number) {
  const fromQuote = price > 0 && market.minQuoteAmount ? market.minQuoteAmount / price : 0;
  const minimum = Math.max(market.minBaseAmount ?? 0, fromQuote);
  return fromUnits(toUnits(minimum, market.szDecimals, "ceil"), market.szDecimals);
}

/** Base size for a USD notional, truncated to the size decimals. */
export function sizeForNotional(usd: number, price: number, sizeDecimals: number) {
  if (!(usd > 0) || !(price > 0)) return 0;
  return fromUnits(toUnits(usd / price, sizeDecimals, "floor"), sizeDecimals);
}

/** `SignUpdateLeverage` takes the initial margin fraction in bps of 10000: 10x → 1000. */
export function leverageFraction(leverage: number) {
  if (!(leverage >= 1)) throw new RangeError("Leverage must be at least 1");
  return Math.round(10_000 / leverage);
}

/** Position `initial_margin_fraction` is a percentage ("5.00" → 20x). */
export function leverageFromPercent(value: string | number | undefined) {
  const percent = Number(value);
  return percent > 0 ? Math.round(100 / percent) : 1;
}

/**
 * Client order index: unique across markets and at most 2^48 - 1. Milliseconds since epoch times 64 plus a
 * sequence stays below that until the year 2109 and keeps increasing across page loads.
 */
export function nextClientOrderIndex(now: number, previous: number) {
  const candidate = Math.floor(now) * 64;
  const next = candidate > previous ? candidate : previous + 1;
  if (next > MAX_CLIENT_ORDER_INDEX) throw new RangeError("Client order index overflow");
  return next;
}
