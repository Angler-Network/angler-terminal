import type { MarketsByVenue } from "@/lib/venues/routing";
import type { PerpVenueId, VenueMarket } from "@/lib/venues/types";
import { assets } from "@/lib/data";
import type { SpotListing } from "@/lib/spot/listings";
import { marketCategory, type MarketCategory } from "./category";

/**
 * One asset across every perp venue the terminal trades, for the home and Markets pages. Venues come from the market
 * lists themselves, so a new venue shows up here without touching the pages.
 */
export interface AssetRow {
  symbol: string;
  kind: VenueMarket["kind"];
  category: MarketCategory;
  /** The venue's market per venue; on Hyperliquid the main dex wins over HIP-3 dexes listing the same symbol. */
  venues: Partial<Record<PerpVenueId, VenueMarket>>;
  /** Summed over the venues. */
  volume: number;
  openInterest: number;
  /** From the venue with the most volume that reports it. */
  price?: number;
  change24hPct?: number;
}

export type AssetSort = "volume" | "openInterest" | "gainers" | "losers" | "symbol";

export function assetRows(marketsByVenue: MarketsByVenue): AssetRow[] {
  const bySymbol = new Map<string, AssetRow>();
  for (const [venue, markets] of Object.entries(marketsByVenue) as Array<[PerpVenueId, VenueMarket[] | undefined]>) {
    for (const market of markets ?? []) {
      const row = bySymbol.get(market.symbol) ?? { symbol: market.symbol, kind: market.kind, category: "crypto", venues: {}, volume: 0, openInterest: 0 };
      if (market.kind === "stock") row.kind = "stock";
      row.volume += market.volume24hUsd ?? 0;
      row.openInterest += market.openInterestUsd ?? 0;
      const current = row.venues[venue];
      if (!current || market.dex === "") row.venues[venue] = market;
      bySymbol.set(market.symbol, row);
    }
  }
  for (const row of bySymbol.values()) {
    row.category = marketCategory(row.symbol, row.kind);
    const byVolume = Object.values(row.venues).sort((a, b) => (b?.volume24hUsd ?? 0) - (a?.volume24hUsd ?? 0));
    row.price = byVolume.map((market) => market?.markPx ?? market?.midPx).find((price) => price !== undefined && price > 0);
    row.change24hPct = byVolume.map((market) => market?.change24hPct).find((change) => change !== undefined && Number.isFinite(change));
  }
  return [...bySymbol.values()];
}

/** Sorted copy; gainers (losers) keep only assets up (down) on the day, leaving out markets with almost no volume. */
export function sortAssetRows(rows: AssetRow[], sort: AssetSort): AssetRow[] {
  if (sort === "symbol") return [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (sort === "volume") return [...rows].sort((a, b) => b.volume - a.volume);
  if (sort === "openInterest") return [...rows].sort((a, b) => b.openInterest - a.openInterest);
  const direction = sort === "gainers" ? -1 : 1;
  const movers = rows.filter((row) => row.change24hPct !== undefined && -direction * row.change24hPct > 0 && row.volume >= 100_000);
  return movers.sort((a, b) => direction * (a.change24hPct! - b.change24hPct!));
}

/**
 * Asset names by terminal symbol from the spot listings (perp venues send tickers only): "TSLA" → "Tesla". Stock
 * venues name a stock best, so Arcus and the order books win over Jupiter's token names.
 */
export function assetNames(listings: SpotListing[] | null): Map<string, string> {
  const names = new Map<string, string>();
  const rank = (listing: SpotListing) => (listing.venue === "jupiter" || listing.venue === "uniswap" ? 1 : 0);
  for (const listing of [...(listings ?? [])].filter((entry) => entry.verified).sort((a, b) => rank(a) - rank(b))) {
    const symbol = (listing.asset ?? listing.symbol).toUpperCase();
    if (!names.has(symbol) && listing.name && listing.name.toUpperCase() !== symbol) names.set(symbol, listing.name);
  }
  return names;
}

/** By ticker, or by name ("bitc" finds BTC, "tesla" TSLA) from the built-in catalog and `names`. */
export function matchesQuery(row: AssetRow, query: string, names?: Map<string, string>) {
  const wanted = query.trim().toUpperCase();
  if (!wanted || row.symbol.includes(wanted)) return true;
  return [assets[row.symbol]?.name, names?.get(row.symbol)].some((name) => name?.toUpperCase().includes(wanted));
}
