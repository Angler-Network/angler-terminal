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

/** One key per asset across venues: Hyperliquid's kPEPE and Aster's 1000PEPE are the same coin. */
const assetKey = (symbol: string) => symbol.replace(/^(?:k|1000)(?=[A-Z])/, "").toUpperCase();

/**
 * Every coin price alerts can watch: Hyperliquid's mids (main dex and HIP-3 dexes) first, then what only Lighter,
 * Lighter RH or Aster lists (in that order), named with the venue's prefix. A symbol listed in several places keeps
 * the first source, so Hyperliquid's price wins (thousand-unit names count as their asset: kPEPE = 1000PEPE). Majors first, then main coins, HIP-3 coins and other venues' coins A-Z.
 */
export function mergeAlertCoins(hlMids: Record<string, number>, others: Array<{ venue: Exclude<PriceVenue, "hyperliquid">; markets: PriceMarket[] }>): AlertCoin[] {
  const coins: AlertCoin[] = [];
  const seen = new Set<string>();
  for (const [coin, mid] of Object.entries(hlMids)) {
    if (!(mid > 0) || coin.startsWith("@") || coin.startsWith("#")) continue;
    coins.push({ coin, mid, venue: "hyperliquid", stock: coin.includes(":") });
    seen.add(assetKey(displayCoin(coin)));
  }
  for (const { venue, markets } of others) {
    for (const market of markets) {
      const key = assetKey(market.symbol);
      if (!(market.price && market.price > 0) || !SYMBOL.test(market.symbol) || seen.has(key)) continue;
      coins.push({ coin: `${venue}:${market.symbol}`, mid: market.price, venue, stock: market.stock });
      seen.add(key);
    }
  }
  const rank = (entry: AlertCoin) => {
    const pinned = entry.venue === "hyperliquid" ? PINNED.indexOf(entry.coin) : -1;
    if (pinned >= 0) return pinned;
    if (entry.venue !== "hyperliquid") return PINNED.length + 2;
    return entry.stock ? PINNED.length + 1 : PINNED.length;
  };
  return coins.sort((a, b) => rank(a) - rank(b) || displayCoin(a.coin).localeCompare(displayCoin(b.coin)));
}

/** Prices by alert name, as the tick checks them. */
export function alertPrices(coins: AlertCoin[]): Record<string, number> {
  return Object.fromEntries(coins.map((entry) => [entry.coin, entry.mid]));
}
