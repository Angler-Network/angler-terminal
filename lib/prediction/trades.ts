/**
 * The live trades feed on /prediction: Polymarket's most recent taker trades across every market
 * (`data-api.polymarket.com/trades`, public, read through our server). Pure, unit-tested.
 */

export interface PredictionTrade {
  id: string;
  title: string;
  outcome: string;
  side: "buy" | "sell";
  /** 0-1 (the outcome's probability at the fill). */
  price: number;
  /** Shares. */
  size: number;
  /** Size × price, in USDC. */
  usd: number;
  /** Milliseconds. */
  time: number;
  /** Polymarket name, else its generated pseudonym, else a short wallet. */
  trader: string;
  icon: string | null;
}

/** Trades smaller than this many dollars are left out by default (Polymarket's own feed starts at $1). */
export const DEFAULT_MIN_TRADE_USD = 1;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const finite = (value: unknown) => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
};

export function readPolymarketTrades(body: unknown): PredictionTrade[] {
  return (Array.isArray(body) ? (body as Array<Record<string, unknown>>) : []).flatMap((row, index): PredictionTrade[] => {
    const price = finite(row?.price);
    const size = finite(row?.size);
    const seconds = finite(row?.timestamp);
    const title = text(row?.title);
    if (price === null || size === null || seconds === null || !title || !(size > 0)) return [];
    const wallet = text(row.proxyWallet);
    const icon = text(row.icon);
    return [
      {
        id: `${text(row.transactionHash) || wallet}:${text(row.asset)}:${index}`,
        title,
        outcome: text(row.outcome) || "—",
        side: row.side === "SELL" ? "sell" : "buy",
        price,
        size,
        usd: size * price,
        time: seconds * 1000,
        trader: text(row.name) || text(row.pseudonym) || (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Trader"),
        icon: icon.startsWith("https://") ? icon : null,
      },
    ];
  });
}
