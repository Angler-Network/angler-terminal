import { roundPrice } from "@/lib/venues/hyperliquid/pricing";
import { HIP4_MIN_ORDER_USD } from "./hip4";

/**
 * Order math for HIP-4 outcome markets: contracts are whole numbers (szDecimals 0), prices stay inside (0, 1) and
 * follow Hyperliquid's spot price rule (5 significant figures, 8 decimals), and an order is worth at least 10 USDC.
 */

/** How far a market order may fill past the book's edge, in probability points (5¢ on a $1 contract). */
export const OUTCOME_SLIPPAGE = 0.05;
const MIN_PRICE = 0.0001;
const MAX_PRICE = 0.9999;

/** The aggressive limit for an IOC market order: best price ± slippage, kept inside (0, 1). */
export function outcomeMarketPrice(reference: number, isBuy: boolean) {
  const raw = isBuy ? reference + OUTCOME_SLIPPAGE : reference - OUTCOME_SLIPPAGE;
  return roundPrice(Math.min(MAX_PRICE, Math.max(MIN_PRICE, raw)), 0, true);
}

/** Whole contracts a dollar amount buys at `price`. */
export function contractsFor(usd: number, price: number) {
  return usd > 0 && price > 0 ? Math.floor(usd / price + 1e-9) : 0;
}

/** Why an order of `contracts` at `price` can't be sent, or null. */
export function outcomeOrderError(contracts: number, price: number): string | null {
  if (!(contracts >= 1)) return "Enter at least one contract.";
  if (contracts * price < HIP4_MIN_ORDER_USD) return `Hyperliquid needs at least $${HIP4_MIN_ORDER_USD} per order (${Math.ceil(HIP4_MIN_ORDER_USD / price)} contracts at this price).`;
  return null;
}

/** An outcome holding from `spotClearinghouseState`: balances named `+N` for the `#N` coin. */
export interface OutcomeHolding {
  coin: string;
  contracts: number;
  /** What the contracts cost in USDC. */
  cost: number;
}

export function readOutcomeHoldings(state: unknown): OutcomeHolding[] {
  const balances = (state as { balances?: unknown } | null)?.balances;
  return (Array.isArray(balances) ? balances : []).flatMap((entry) => {
    const record = entry as { coin?: unknown; total?: unknown; entryNtl?: unknown };
    const match = typeof record.coin === "string" ? /^\+(\d+)$/.exec(record.coin) : null;
    const contracts = Number(record.total);
    if (!match || !(contracts > 0)) return [];
    return [{ coin: `#${match[1]}`, contracts, cost: Number(record.entryNtl) || 0 }];
  });
}

/** Spot USDC free to spend: total minus what open orders hold. */
export function readSpotUsdc(state: unknown) {
  const balances = (state as { balances?: unknown } | null)?.balances;
  const usdc = (Array.isArray(balances) ? balances : []).find((entry) => (entry as { coin?: unknown }).coin === "USDC") as { total?: unknown; hold?: unknown } | undefined;
  return Math.max(0, (Number(usdc?.total) || 0) - (Number(usdc?.hold) || 0));
}
