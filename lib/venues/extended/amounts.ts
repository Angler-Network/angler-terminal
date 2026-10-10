/**
 * The integer amounts an Extended order is Stark-signed over, computed exactly as the official SDK does
 * (x10/signing/order_object_settlement.py) but with BigInt decimals instead of floats: synthetic = qty × synthetic
 * resolution, collateral = qty × price × collateral resolution (rounded up when buying, down when selling, the buyer's
 * collateral and the seller's synthetic negated), max fee = (taker fee + builder fee) × qty × price × collateral
 * resolution, always rounded up. Settlement expiry = the order's expiry + 14 days, in whole seconds rounded up.
 */

export const SETTLEMENT_BUFFER_DAYS = 14;

interface Decimal {
  units: bigint;
  scale: number;
}

/** A decimal string or number as an exact integer and its number of decimals ("0.0001" → 1n, 4). */
export function toDecimal(value: string | number): Decimal {
  let text = typeof value === "number" ? numberText(value) : value.trim();
  const negative = text.startsWith("-");
  if (negative) text = text.slice(1);
  if (!/^\d*(\.\d*)?$/.test(text) || text === "" || text === ".") throw new Error(`Not a decimal: ${value}`);
  const [whole, fraction = ""] = text.split(".");
  const units = BigInt(`${whole || "0"}${fraction}`) * (negative ? -1n : 1n);
  return { units, scale: fraction.length };
}

/** A float as a plain decimal string (no exponent), trimmed. */
export function numberText(value: number) {
  if (!Number.isFinite(value)) throw new Error(`Not a number: ${value}`);
  const text = Math.abs(value) < 1e-6 || Math.abs(value) >= 1e21 ? value.toFixed(18) : String(value);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** Product of decimals divided down to an integer, rounded up or down (toward +∞ / −∞ for positives). */
function product(values: Array<string | number>, roundUp: boolean) {
  let units = 1n;
  let scale = 0;
  for (const value of values) {
    const decimal = toDecimal(value);
    units *= decimal.units;
    scale += decimal.scale;
  }
  const divisor = 10n ** BigInt(scale);
  const quotient = units / divisor;
  const remainder = units % divisor;
  return roundUp && remainder > 0n ? quotient + 1n : quotient;
}

export interface SettlementInput {
  side: "buy" | "sell";
  qty: string;
  price: string;
  /** Fractions: 0.00025 = 2.5 bps. */
  takerFee: string;
  builderFee: string;
  syntheticResolution: number;
  collateralResolution: number;
}

export function settlementAmounts(input: SettlementInput) {
  const buy = input.side === "buy";
  const synthetic = product([input.qty, input.syntheticResolution], buy);
  const collateral = product([input.qty, input.price, input.collateralResolution], buy);
  // (taker + builder) as one decimal: summed exactly at a common scale.
  const taker = toDecimal(input.takerFee);
  const builder = toDecimal(input.builderFee);
  const scale = Math.max(taker.scale, builder.scale);
  const feeRate = taker.units * 10n ** BigInt(scale - taker.scale) + builder.units * 10n ** BigInt(scale - builder.scale);
  const fee = product([rateText(feeRate, scale), input.qty, input.price, input.collateralResolution], true);
  return {
    synthetic: buy ? synthetic : -synthetic,
    collateral: buy ? -collateral : collateral,
    fee,
  };
}

function rateText(units: bigint, scale: number) {
  const text = units.toString().padStart(scale + 1, "0");
  return scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}` : text;
}

/** The settlement expiry Extended signs: order expiry + 14 days, whole seconds rounded up. */
export function settlementExpiration(expiryMs: number) {
  return Math.ceil(expiryMs / 1000 + SETTLEMENT_BUFFER_DAYS * 86_400);
}

/** Decimals of a step written as a string ("0.00001" → 5, "1" → 0). */
export function stepDecimals(step: string) {
  const fraction = step.split(".")[1] ?? "";
  return fraction.replace(/0+$/, "").length;
}

/** A value rounded to a step ("0.00001", "1", "0.5") as a decimal string, down / up / to nearest. */
export function roundToStep(value: number, step: string, mode: "down" | "up" | "nearest" = "nearest") {
  const stepValue = Number(step);
  if (!(stepValue > 0)) return numberText(value);
  const ratio = value / stepValue;
  const steps = mode === "down" ? Math.floor(ratio + 1e-9) : mode === "up" ? Math.ceil(ratio - 1e-9) : Math.round(ratio);
  return (steps * stepValue).toFixed(Math.max(stepDecimals(step), 0));
}

/**
 * Worst price for a market order: Extended takes market orders as IOC with a price within the market's band around
 * the mark; its own app pays up to 1.5% through the touch. Capped inside `limitPriceCap` / `limitPriceFloor` of the mark.
 */
export function marketOrderPrice(input: { side: "buy" | "sell"; reference: number; mark: number; tick: string; cap: number; floor: number; slippage?: number }) {
  const slippage = input.slippage ?? 0.015;
  const raw = input.side === "buy" ? input.reference * (1 + slippage) : input.reference * (1 - slippage);
  const bounded = input.mark > 0 ? Math.min(Math.max(raw, input.mark * (1 - input.floor)), input.mark * (1 + input.cap)) : raw;
  return roundToStep(bounded, input.tick, input.side === "buy" ? "down" : "up");
}
