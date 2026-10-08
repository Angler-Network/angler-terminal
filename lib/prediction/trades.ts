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
  /** The market's slug: `/api/prediction/resolve` turns it into its event, so a row can open it. */
  slug: string | null;
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
        slug: /^[a-z0-9-]{1,200}$/.test(text(row.slug)) ? text(row.slug) : null,
      },
    ];
  });
}

/** What a HIP-4 outcome coin ("#123") stands for in the feed: its event's title and the side's label. */
export interface Hip4CoinInfo {
  title: string;
  outcome: string;
  /** The event's id here (`hl:…`), so a row can open it. */
  eventId: string;
  icon: string | null;
}

/**
 * Hyperliquid `trades` stream messages for HIP-4 outcome coins → feed rows. `side` "B" means the taker bought; the
 * taker is the first of `users` when buying, else the second.
 */
export function readHip4Trades(data: unknown, coins: Map<string, Hip4CoinInfo>): Array<PredictionTrade & { eventId: string }> {
  return (Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []).flatMap((row): Array<PredictionTrade & { eventId: string }> => {
    const info = typeof row?.coin === "string" ? coins.get(row.coin) : undefined;
    const price = finite(row?.px);
    const size = finite(row?.sz);
    const time = finite(row?.time);
    if (!info || price === null || size === null || time === null || !(size > 0) || (row.side !== "B" && row.side !== "A")) return [];
    const users = Array.isArray(row.users) ? row.users.filter((user): user is string => typeof user === "string") : [];
    const taker = row.side === "B" ? users[0] : users[1];
    return [
      {
        id: `hl:${String(row.tid ?? `${row.coin}-${time}`)}`,
        title: info.title,
        outcome: info.outcome,
        side: row.side === "B" ? "buy" : "sell",
        price,
        size,
        usd: size * price,
        time,
        trader: taker ? `${taker.slice(0, 6)}…${taker.slice(-4)}` : "Trader",
        icon: info.icon,
        slug: null,
        eventId: info.eventId,
      },
    ];
  });
}
