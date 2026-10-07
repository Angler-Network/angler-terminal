"use client";

import { useMemo, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { usePreferences } from "@/components/app/preferences-provider";
import { useMarketList } from "@/components/app/use-market-list";
import { formatPercent } from "@/lib/format";
import { marketCategory, type MarketCategory } from "@/lib/markets/category";
import { pickQuote } from "@/lib/markets/model";
import { assetSymbolOf, mergeListings, type SpotCategory, type SpotListing } from "@/lib/spot/listings";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { perpWatchId, type WatchlistEntry } from "@/lib/watchlist";
import { useTrading } from "./trading-provider";
import { useSpotListings, useSpotSearch } from "./use-spot-listings";

/** One market row (search modal, watchlist panel), perp or spot. */
export interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  /** The terminal asset picking the row selects (WBTC → BTC). */
  asset: string;
  mint?: string;
  icon?: string;
  kind: "crypto" | "stock";
  category: MarketCategory;
  price?: number;
  change24h?: number;
  volume24h?: number;
  liquidity?: number;
  venues: string[];
  verified: boolean;
  /** Dollar token: sorted after the rest in lists. */
  stable?: boolean;
  watch: WatchlistEntry;
}

const SPOT_CATEGORY: Record<SpotCategory, MarketCategory> = { crypto: "crypto", stock: "stocks", index: "indices", commodity: "commodities" };
const SPOT_VENUE_NAMES = { jupiter: "Jupiter", arcus: "Arcus" } as const;

/** Every perp market an enabled perp venue lists, priced from the shared market list (Binance, then Hyperliquid). */
export function usePerpRows(enabled: boolean): MarketRow[] | null {
  const { marketsByVenue, perpOrder } = useTrading();
  const { preferences } = usePreferences();
  const quotes = useMarketList("perp");
  return useMemo(() => {
    if (!enabled) return null;
    const lists = perpOrder.map((venue) => [venue, marketsByVenue[venue]] as const);
    if (lists.every(([, list]) => list === undefined)) return null;
    const bySymbol = new Map((quotes ?? []).map((market) => [market.symbol, market]));
    const rows = new Map<string, MarketRow>();
    for (const [venue, list] of lists) {
      for (const market of list ?? []) {
        const existing = rows.get(market.symbol);
        if (existing) {
          existing.venues.push(PERP_VENUE_NAMES[venue as PerpVenueId]);
          existing.volume24h = (existing.volume24h ?? 0) + (market.volume24hUsd ?? 0);
          continue;
        }
        const quote = bySymbol.get(market.symbol);
        const picked = quote ? pickQuote(quote, preferences.tapeSource)?.quote : undefined;
        rows.set(market.symbol, {
          id: perpWatchId(market.symbol),
          symbol: market.symbol,
          name: market.kind === "stock" ? "Stock perp" : "Perpetual",
          asset: market.symbol,
          kind: market.kind,
          category: marketCategory(market.symbol, market.kind),
          price: picked?.price ?? market.markPx ?? market.midPx,
          change24h: picked?.changePct,
          volume24h: market.volume24hUsd,
          venues: [PERP_VENUE_NAMES[venue as PerpVenueId]],
          verified: true,
          watch: { id: perpWatchId(market.symbol), kind: "perp", symbol: market.symbol, asset: market.symbol },
        });
      }
    }
    return [...rows.values()].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  }, [enabled, marketsByVenue, perpOrder, quotes, preferences.tapeSource]);
}

export function spotRow(listing: SpotListing, options: { anyToken?: boolean } = {}): MarketRow | null {
  // Tokens that stand for no terminal asset (stablecoins…) are skipped, unless picking a token to pay with.
  const asset = assetSymbolOf(listing) ?? (options.anyToken ? listing.symbol : null);
  if (!asset) return null;
  const mint = listing.venue === "jupiter" ? listing.address : undefined;
  return {
    id: listing.id,
    symbol: listing.symbol,
    name: listing.name,
    asset,
    mint,
    icon: listing.icon,
    kind: listing.category === "crypto" ? "crypto" : "stock",
    category: SPOT_CATEGORY[listing.category],
    price: listing.price,
    change24h: listing.change24h,
    volume24h: listing.volume24h,
    liquidity: listing.liquidity,
    venues: [SPOT_VENUE_NAMES[listing.venue]],
    verified: listing.verified,
    stable: listing.stable,
    watch: { id: listing.id, kind: "spot", symbol: listing.symbol, asset, name: listing.name, icon: listing.icon, mint },
  };
}

export function TokenIcon({ row }: { row: MarketRow }) {
  const [failed, setFailed] = useState(false);
  if (row.icon && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={row.icon} alt="" width={24} height={24} loading="lazy" onError={() => setFailed(true)} className="size-6 shrink-0 rounded-full object-cover" />;
  }
  return <MarketIcon symbol={row.asset} kind={row.kind} size={24} />;
}

export function Change({ value }: { value?: number }) {
  if (value === undefined) return <span className="text-app-faint">—</span>;
  return (
    <span className={value >= 0 ? "text-app-up" : "text-app-down"}>
      {value >= 0 ? "+" : "-"}
      {formatPercent(value)}
    </span>
  );
}

/**
 * Every spot pair (plus the live search results for `query`), as rows; null until the pairs load. `solanaTokens` keeps
 * Solana tokens only, every one of them (the swap card's pay token picker).
 */
export function useSpotRows(enabled: boolean, query = "", solanaTokens = false) {
  const listings = useSpotListings(enabled);
  const searched = useSpotSearch(enabled ? query : "");
  const rows = useMemo(() => {
    if (!enabled || !listings) return null;
    return mergeListings(listings, searched ?? [])
      .filter((listing) => !solanaTokens || listing.venue === "jupiter")
      .flatMap((listing) => spotRow(listing, { anyToken: solanaTokens }) ?? []);
  }, [enabled, listings, searched, solanaTokens]);
  return { rows, searching: query.trim().length >= 2 && searched === undefined };
}
