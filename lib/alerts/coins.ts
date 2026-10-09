import { displayCoin } from "./rules";

/** A coin a price alert can watch: Hyperliquid's name ("BTC", "xyz:NVDA") and its mid price now. */
export interface AlertCoin {
  coin: string;
  mid: number;
  /** HIP-3 dex coins (stocks, indices) carry their dex. */
  dex: string | null;
}

const PINNED = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE"];

/** Every coin with a mid, majors first, then the main dex A-Z, then the HIP-3 dexes A-Z. */
export function readAlertCoins(mids: Record<string, number>): AlertCoin[] {
  const coins = Object.entries(mids)
    .filter(([coin, mid]) => mid > 0 && !coin.startsWith("@") && !coin.startsWith("#"))
    .map(([coin, mid]) => ({ coin, mid, dex: coin.includes(":") ? coin.split(":")[0] : null }));
  const rank = (entry: AlertCoin) => {
    const pinned = PINNED.indexOf(entry.coin);
    return pinned >= 0 ? pinned : entry.dex ? PINNED.length + 1 : PINNED.length;
  };
  return coins.sort((a, b) => rank(a) - rank(b) || displayCoin(a.coin).localeCompare(displayCoin(b.coin)));
}
