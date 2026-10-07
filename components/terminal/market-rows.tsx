"use client";

import { useMemo, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { usePreferences } from "@/components/app/preferences-provider";
import { useMarketList } from "@/components/app/use-market-list";
import { formatPercent } from "@/lib/format";
import { marketCategory, type MarketCategory } from "@/lib/markets/category";
import { pickQuote } from "@/lib/markets/model";
import { parseBookSpotRef, type BookSpotVenue } from "@/lib/spot/book-spot";
import { assetSymbolOf, mergeListings, type SpotCategory, type SpotListing } from "@/lib/spot/listings";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import { EVM_SWAP_CHAINS, evmRef, evmSwapChain, parseEvmRef, type EvmSwapChainKey } from "@/lib/venues/uniswap/chains";
import { CoinIcon } from "./token-icon";
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
  /** Spot rows: the chain the token lives on (the search's chain filter). */
  chain?: RowChain;
  watch: WatchlistEntry;
}

/** "arcus": Arcus's stock tokens, on Robinhood Chain but filtered on their own ("robinhood" is the chain's Uniswap tokens). */
export type RowChain = "solana" | EvmSwapChainKey | BookSpotVenue | "arcus";

/**
 * The chains the spot search filters by, in the order the filter shows them (logos in `public/chains`; Lighter, an
 * exchange rather than a chain, uses its site icon). Hyperliquid and Lighter hold their own order-book spot markets.
 */
export const ROW_CHAINS: Array<{ key: RowChain; name: string; logo?: string }> = [
  { key: "solana", name: "Solana" },
  { key: "ethereum", name: "Ethereum" },
  { key: "base", name: "Base" },
  { key: "arbitrum", name: "Arbitrum" },
  { key: "robinhood", name: "Robinhood Chain" },
  { key: "arcus", name: "Arcus (stock tokens on Robinhood Chain)", logo: "/api/favicon?domain=arcus.xyz" },
  { key: "hyperliquid", name: "Hyperliquid" },
  { key: "lighter", name: "Lighter", logo: "/api/favicon?domain=lighter.xyz" },
];

/** A row's chain: its own, else read from the mint (an EVM ref, or a Solana mint). */
export function rowChain(row: MarketRow): RowChain | undefined {
  if (row.chain) return row.chain;
  if (!row.mint) return undefined;
  const book = parseBookSpotRef(row.mint);
  if (book) return book.venue;
  return parseEvmRef(row.mint)?.chain.key ?? (/^(evm|book):/.test(row.mint) ? undefined : "solana");
}

const SPOT_CATEGORY: Record<SpotCategory, MarketCategory> = { crypto: "crypto", stock: "stocks", index: "indices", commodity: "commodities" };
const SPOT_VENUE_NAMES = { jupiter: "Jupiter", arcus: "Arcus", uniswap: "Uniswap", hyperliquid: "Hyperliquid", lighter: "Lighter" } as const;

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
  // Uniswap tokens ride in the mint slot as "evm:<chain>:<address>" (`chains.ts`).
  const evmChain = listing.venue === "uniswap" ? evmSwapChain(listing.chainId) : null;
  // Hyperliquid and Lighter spot markets ride there as "book:<venue>:<id>" (`book-spot.ts`).
  const isBook = listing.venue === "hyperliquid" || listing.venue === "lighter";
  const mint = listing.venue === "jupiter" || isBook ? listing.address : evmChain ? evmRef(evmChain.id, listing.address) : undefined;
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
    venues: [evmChain ? `${SPOT_VENUE_NAMES[listing.venue]} · ${evmChain.name}` : SPOT_VENUE_NAMES[listing.venue]],
    verified: listing.verified,
    stable: listing.stable,
    chain: listing.venue === "jupiter" ? "solana" : listing.venue === "arcus" ? "arcus" : isBook ? (listing.venue as BookSpotVenue) : evmChain?.key,
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
 * Every spot pair (plus the live search results for `query`), as rows; null until the pairs load. `only` keeps those
 * venues' tokens, every one of them, stablecoins included (the swap cards' pay token pickers: Jupiter, or Uniswap + Jupiter).
 */
export function useSpotRows(enabled: boolean, query = "", only?: SpotListing["venue"][]) {
  const listings = useSpotListings(enabled);
  const searched = useSpotSearch(enabled ? query : "");
  const { preferences } = usePreferences();
  const { venueHyperliquid, venueLighter } = preferences;
  const rows = useMemo(() => {
    if (!enabled || !listings) return null;
    // Order-book spot markets follow the perp venue switches in Settings.
    const off = (listing: SpotListing) => (listing.venue === "hyperliquid" && !venueHyperliquid) || (listing.venue === "lighter" && !venueLighter);
    return mergeListings(listings, searched ?? [])
      .filter((listing) => (!only || (only as string[]).includes(listing.venue)) && !off(listing))
      .flatMap((listing) => spotRow(listing, { anyToken: Boolean(only) }) ?? []);
  }, [enabled, listings, searched, only, venueHyperliquid, venueLighter]);
  return { rows, searching: query.trim().length >= 2 && searched === undefined };
}

/** Logo source (site favicon through /api/favicon) and chain badge for each venue label a row can carry. */
const VENUE_MARKS: Record<string, { domain: string; chain?: number | string }> = {
  Hyperliquid: { domain: "hyperliquid.xyz" },
  Lighter: { domain: "lighter.xyz" },
  "Lighter RH": { domain: "lighter.xyz", chain: 4663 },
  Jupiter: { domain: "jup.ag", chain: "solana" },
  Arcus: { domain: "arcus.xyz", chain: 4663 },
  Uniswap: { domain: "uniswap.org" },
};

/**
 * A row's venues as logos with the chain in the corner ("Uniswap · Base" = Uniswap's logo, Base badge), the full names
 * on hover. One venue also gets a short label (the chain for Uniswap, else the venue); labels without a logo
 * ("Wallet", "Popular") stay text.
 */
export function VenueMarks({ venues }: { venues: string[] }) {
  if (venues.length === 0) return <span className="text-app-faint">—</span>;
  const marks = venues.map((label) => {
    const [name, chainName] = label.split(" · ");
    const mark = VENUE_MARKS[name];
    const chain = chainName ? EVM_SWAP_CHAINS.find((entry) => entry.name === chainName)?.id : mark?.chain;
    return { label, name, chainName, mark, chain };
  });
  if (marks.some((entry) => !entry.mark)) return <span className="truncate">{venues.join(" · ")}</span>;
  const single = marks.length === 1 ? marks[0] : null;
  return (
    <span className="flex min-w-0 items-center justify-end gap-1.5" title={venues.join(", ")}>
      <span className="flex shrink-0 items-center gap-1">
        {marks.map((entry) => (
          <CoinIcon key={entry.label} src={`/api/favicon?domain=${entry.mark!.domain}`} symbol={entry.name} chain={entry.chain} size={18} />
        ))}
      </span>
      {single && <span className="truncate">{single.chainName ?? single.name}</span>}
    </span>
  );
}
