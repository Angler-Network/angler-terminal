import { orderlyBase } from "./markets";

/**
 * Orderly funding for the cross-venue funding table: each market's last rate (`/v1/public/futures`) over its funding
 * period (`/v1/public/info`, hours), normalized to 8 hours like the other venues. Mainnet only (testnet funding means
 * nothing); broker-only markets are left out. Pure, unit-tested.
 */

export const ORDERLY_MAINNET_API = "https://api.orderly.org";

interface FuturesRow {
  symbol?: unknown;
  last_funding_rate?: unknown;
}

interface InfoRow {
  symbol?: unknown;
  funding_period?: unknown;
}

export function orderlyFundingRows(futures: FuturesRow[], info: InfoRow[]) {
  const hours = new Map(info.map((row) => [String(row.symbol), Number(row.funding_period)]));
  return futures.flatMap((row) => {
    const symbol = typeof row.symbol === "string" ? row.symbol : "";
    const base = orderlyBase(symbol);
    const rate = Number(row.last_funding_rate);
    if (!base || !Number.isFinite(rate)) return [];
    const period = hours.get(symbol);
    return [{ exchange: "orderly", symbol: base, rate: rate * (8 / (period && period > 0 ? period : 8)) }];
  });
}
