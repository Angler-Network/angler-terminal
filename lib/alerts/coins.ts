import { PRICE_VENUE_PREFIXES, displayCoin } from "./rules";

export type PriceVenue = "hyperliquid" | keyof typeof PRICE_VENUE_PREFIXES;

/** A coin a price alert can watch: its alert name ("BTC", "xyz:NVDA", "aster:FOO"), price now and venue. */
export interface AlertCoin {
  coin: string;
  mid: number;
  venue: PriceVenue;
  stock: boolean;
}

/** One market of another venue as the alerts read it. */
export interface PriceMarket {
  symbol: string;
  price: number | undefined;
  stock: boolean;
}

const PINNED = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE"];
const SYMBOL = /^k?[A-Z0-9]{1,20}$/;
export const PRICE_VENUES: PriceVenue[] = ["hyperliquid", "lighter", "lighterrh", "aster"];
export const PRICE_VENUE_LABELS: Record<PriceVenue, string> = { hyperliquid: "Hyperliquid", ...PRICE_VENUE_PREFIXES };

/**
 * Every coin price alerts can watch, per venue (the alert names its venue): Hyperliquid's mids (main dex and HIP-3
 * dexes) as Hyperliquid names them, and every Lighter, Lighter RH and Aster market with the venue's prefix
 * ("aster:BTC"). Per venue: majors first, then crypto A-Z, then stocks A-Z.
 */
export function readAlertCoins(hlMids: Record<string, number>, others: Array<{ venue: Exclude<PriceVenue, "hyperliquid">; markets: PriceMarket[] }>): AlertCoin[] {
  const coins: AlertCoin[] = [];
  for (const [coin, mid] of Object.entries(hlMids)) {
    if (!(mid > 0) || coin.startsWith("@") || coin.startsWith("#")) continue;
    coins.push({ coin, mid, venue: "hyperliquid", stock: coin.includes(":") });
  }
  for (const { venue, markets } of others) {
    const seen = new Set<string>();
    for (const market of markets) {
      if (!(market.price && market.price > 0) || !SYMBOL.test(market.symbol) || seen.has(market.symbol)) continue;
      coins.push({ coin: `${venue}:${market.symbol}`, mid: market.price, venue, stock: market.stock });
      seen.add(market.symbol);
    }
  }
  const rank = (entry: AlertCoin) => {
    const pinned = PINNED.indexOf(displayCoin(entry.coin));
    return pinned >= 0 && !entry.stock ? pinned : entry.stock ? PINNED.length + 1 : PINNED.length;
  };
  return coins.sort(
    (a, b) => PRICE_VENUES.indexOf(a.venue) - PRICE_VENUES.indexOf(b.venue) || rank(a) - rank(b) || displayCoin(a.coin).localeCompare(displayCoin(b.coin)),
  );
}

/** Prices by alert name, as the tick checks them. */
export function alertPrices(coins: AlertCoin[]): Record<string, number> {
  return Object.fromEntries(coins.map((entry) => [entry.coin, entry.mid]));
}
