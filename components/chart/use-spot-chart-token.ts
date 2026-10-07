"use client";

import { usePathname } from "next/navigation";
import { usePreferences } from "@/components/app/preferences-provider";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useArcusToken } from "@/components/terminal/use-arcus-token";
import { useEvmToken } from "@/components/terminal/use-evm-token";
import { useSpotListings } from "@/components/terminal/use-spot-listings";
import { useSpotToken } from "@/components/terminal/use-spot-token";
import { BOOK_SPOT_VENUE_NAMES, hlSpotCoin, parseBookSpotRef, pickBookSpotListing } from "@/lib/spot/book-spot";
import type { PoolNetwork } from "@/lib/spot/pool-candles";
import { terminalKindOf } from "@/lib/terminal-kind";
import { useBookSpotRef } from "@/components/terminal/use-book-spot";
import { arcusConfig } from "@/lib/venues/arcus/config";
import { robinhoodSources } from "@/lib/venues/robinhood-sources";
import { isEvmRef, isNativeToken, wrappedNative } from "@/lib/venues/uniswap/chains";

/** The token /swap actually trades for the selected asset, with what the chart header shows about it. */
export interface SpotChartToken {
  /** Chain its pools live on; null when the on-chain data has no index for it (Arcus testnet). */
  network: PoolNetwork | null;
  address: string;
  symbol: string;
  name: string;
  icon?: string;
  /** "Jupiter", "Arcus", "Uniswap · Base", "Hyperliquid". */
  venue: string;
  /** A Hyperliquid or Lighter spot market: charted from the venue's own candles. */
  book?: { venue: "hyperliquid" | "lighter"; coin: string; id: number };
  price?: number;
  change24h?: number;
  liquidity?: number;
  volume24h?: number;
  marketCap?: number;
}

/**
 * On /spot: the Hyperliquid or Lighter spot market the view trades (its own candles). On /swap: the traded token (Jupiter's, which the order panel resolves the same way: BTC → the most traded BTC token;
 * else Arcus's stock token), live numbers from the spot pairs list. null outside /swap or when no spot venue lists the
 * asset; undefined while resolving.
 */
export function useSpotChartToken(): SpotChartToken | null | undefined {
  const kind = terminalKindOf(usePathname());
  const isSpot = kind === "spot";
  const isBook = kind === "book";
  // /spot: the order-book market the view trades.
  const bookRef = useBookSpotRef();
  const { symbol, mint } = useSelectedAsset();
  const { preferences } = usePreferences();
  const jupiter = useSpotToken(symbol, mint, isSpot && preferences.venueJupiter);
  const needArcus = isSpot && robinhoodSources(preferences).length > 0 && jupiter === null && !mint;
  const arcus = useArcusToken(symbol, needArcus);
  const listings = useSpotListings(isSpot || isBook);
  // A Uniswap token picked in the search (Base, Arbitrum, Ethereum).
  const evm = useEvmToken(isSpot ? mint : undefined);

  /** A Hyperliquid or Lighter spot market: picked (`book:` ref), or the asset's only spot market. */
  const bookToken = (ref: string | undefined): SpotChartToken | null => {
    const book = parseBookSpotRef(ref);
    if (!book) return null;
    const listing = listings?.find((entry) => entry.id === `${book.venue}:${book.id}`);
    return {
      network: null,
      address: ref!,
      symbol: listing?.symbol ?? symbol,
      name: listing?.name ?? symbol,
      venue: BOOK_SPOT_VENUE_NAMES[book.venue],
      book: { venue: book.venue, coin: book.venue === "hyperliquid" ? hlSpotCoin(book.id) : String(book.id), id: book.id },
      price: listing?.price,
      change24h: listing?.change24h,
      volume24h: listing?.volume24h,
    };
  };
  if (isBook) return bookRef === undefined ? undefined : bookRef ? bookToken(bookRef) : null;
  if (!isSpot) return null;
  if (parseBookSpotRef(mint)) return bookToken(mint);
  if (isEvmRef(mint)) {
    if (!evm) return evm;
    return {
      network: evm.chain.pool,
      // Native ETH has no pools of its own: its chart and trades are WETH's.
      address: isNativeToken(evm.address) ? wrappedNative(evm.chain).address : evm.address,
      symbol: evm.symbol,
      name: evm.name,
      icon: evm.icon,
      venue: `Uniswap · ${evm.chain.name}`,
      price: evm.price,
      change24h: evm.change24h,
      liquidity: evm.liquidity,
      volume24h: evm.volume24h,
      marketCap: evm.marketCap,
    };
  }
  if (jupiter === undefined) return undefined;
  if (jupiter) {
    const listing = listings?.find((entry) => entry.id === `jupiter:${jupiter.mint}`);
    return {
      network: "solana",
      address: jupiter.mint,
      symbol: jupiter.symbol,
      name: jupiter.name,
      icon: jupiter.icon,
      venue: "Jupiter",
      price: listing?.price ?? jupiter.usdPrice,
      change24h: listing?.change24h,
      liquidity: listing?.liquidity ?? jupiter.liquidity,
      volume24h: listing?.volume24h,
      marketCap: listing?.marketCap,
    };
  }
  if (needArcus && arcus === undefined) return undefined;
  if (!arcus) {
    if (mint || !listings) return listings ? null : undefined;
    const fallback = pickBookSpotListing(listings, symbol, { hyperliquid: preferences.venueHyperliquid, lighter: preferences.venueLighter });
    return bookToken(fallback?.address);
  }
  const listing = listings?.find((entry) => entry.id === `arcus:${arcus.address}`);
  return {
    network: arcusConfig.network === "mainnet" ? "robinhood" : null,
    address: arcus.address,
    symbol: arcus.symbol,
    name: arcus.name,
    venue: "Arcus",
    price: listing?.price,
    change24h: listing?.change24h,
  };
}
