/**
 * The wallet's whole order-book spot account on Hyperliquid and Lighter, for the Spot Dex panel under the chart:
 * token balances (with their USD value at the market price) and resting orders on every spot market. Pure,
 * unit-tested; `lib/venues/book-spot-account.ts` fetches.
 */
import type { BookSpotMarket, BookSpotOpenOrder, BookSpotVenue } from "./book-spot";

export interface SpotBalance {
  venue: BookSpotVenue;
  token: string;
  total: number;
  /** Total minus what open orders hold. */
  available: number;
  /** Total at the market price; null when no USDC market prices it. */
  usd: number | null;
  /** The market that trades the token (picking the row opens it); null for USDC and unlisted tokens. */
  market: BookSpotMarket | null;
}

export interface SpotOpenOrderRow extends BookSpotOpenOrder {
  venue: BookSpotVenue;
  market: BookSpotMarket;
}

const finite = (value: unknown) => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : 0;
};

function balance(venue: BookSpotVenue, token: string, total: number, held: number, market: BookSpotMarket | null): SpotBalance {
  const price = token === "USDC" ? 1 : (market?.price ?? null);
  return { venue, token, total, available: Math.max(0, total - held), usd: price === null ? null : total * price, market };
}

const byValue = (a: SpotBalance, b: SpotBalance) => (b.usd ?? -1) - (a.usd ?? -1);

/** Hyperliquid `spotClearinghouseState` → non-zero balances, priced by the market whose base is that token. */
export function readHlSpotBalances(state: unknown, markets: BookSpotMarket[]): SpotBalance[] {
  const balances = (state as { balances?: unknown } | null)?.balances;
  return (Array.isArray(balances) ? (balances as Array<Record<string, unknown>>) : [])
    .flatMap((entry) => {
      const total = finite(entry?.total);
      if (!(total > 0) || typeof entry.coin !== "string") return [];
      const market = markets.find((candidate) => candidate.venue === "hyperliquid" && candidate.baseToken === entry.token) ?? null;
      return [balance("hyperliquid", entry.coin, total, finite(entry.hold), entry.coin === "USDC" ? null : market)];
    })
    .sort(byValue);
}

/** Lighter account `assets` (the spot route) → non-zero balances, named by the spot markets' base/quote asset ids. */
export function readLighterSpotBalances(assets: unknown, markets: BookSpotMarket[]): SpotBalance[] {
  return (Array.isArray(assets) ? (assets as Array<Record<string, unknown>>) : [])
    .flatMap((entry) => {
      const id = finite(entry?.asset_id);
      const total = finite(entry?.balance);
      if (!(total > 0)) return [];
      const lighter = markets.filter((market) => market.venue === "lighter");
      const market = lighter.find((candidate) => candidate.baseToken === id) ?? null;
      const isUsdc = !market && lighter.some((candidate) => candidate.quoteToken === id);
      const token = market?.base ?? (isUsdc ? "USDC" : typeof entry.symbol === "string" ? entry.symbol : `Asset ${id}`);
      return [balance("lighter", token, total, finite(entry.locked_balance), market)];
    })
    .sort(byValue);
}

/** Hyperliquid `openOrders` → the resting orders on spot markets (coins "@N" / "PURR/USDC"), newest first. */
export function readHlSpotOrderRows(body: unknown, markets: BookSpotMarket[]): SpotOpenOrderRow[] {
  const byCoin = new Map(markets.filter((market) => market.venue === "hyperliquid").map((market) => [market.coin, market]));
  return (Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [])
    .flatMap((order): SpotOpenOrderRow[] => {
      const market = typeof order?.coin === "string" ? byCoin.get(order.coin) : undefined;
      if (!market || typeof order.oid !== "number") return [];
      const size = finite(order.sz);
      return [
        {
          venue: "hyperliquid",
          market,
          oid: order.oid,
          side: order.side === "A" ? "sell" : "buy",
          price: finite(order.limitPx),
          size,
          origSize: finite(order.origSz) || size,
          time: finite(order.timestamp),
        },
      ];
    })
    .sort((a, b) => b.time - a.time);
}
