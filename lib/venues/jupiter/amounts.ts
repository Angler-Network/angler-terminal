/**
 * Token amount math in integer base units. Decimals always come from the token's metadata.
 */

/** Converts a non-negative decimal number to base units, rounding down so we never ask for more than intended. */
export function toBaseUnits(value: number | string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new RangeError("Invalid token decimals");
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError("Amount must be a non-negative number");
  // toFixed handles up to 100 digits; extra precision is truncated, not rounded up.
  const [whole, fraction = ""] = number.toFixed(Math.min(decimals + 2, 100)).split(".");
  return BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, "0"));
}

/** Converts base units to a JS number for display. */
export function fromBaseUnits(amount: bigint, decimals: number): number {
  if (decimals === 0) return Number(amount);
  const text = amount.toString().padStart(decimals + 1, "0");
  return Number(`${text.slice(0, -decimals)}.${text.slice(-decimals)}`);
}

export interface SizingToken {
  decimals: number;
  usdPrice?: number;
}

/**
 * Input amount for a USD-sized order. Buying spends the quote stable (USDC → token), so the input is the USD size
 * in USDC units. Selling spends the token (token → USDC), so the input is USD / token price in token units.
 */
export function usdToInputAmount(usd: number, side: "buy" | "sell", quote: SizingToken, token: SizingToken): bigint {
  if (!(usd > 0)) return 0n;
  if (side === "buy") return toBaseUnits(usd / (quote.usdPrice && quote.usdPrice > 0 ? quote.usdPrice : 1), quote.decimals);
  if (!token.usdPrice || !(token.usdPrice > 0)) throw new RangeError("No USD price for this token yet");
  return toBaseUnits(usd / token.usdPrice, token.decimals);
}
