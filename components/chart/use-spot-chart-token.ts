"use client";

import { usePathname } from "next/navigation";
import { usePreferences } from "@/components/app/preferences-provider";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useEvmToken } from "@/components/terminal/use-evm-token";
import { useSpotListings } from "@/components/terminal/use-spot-listings";
import { useSpotToken } from "@/components/terminal/use-spot-token";
import { BOOK_SPOT_VENUE_NAMES, hlSpotCoin, parseBookSpotRef } from "@/lib/spot/book-spot";
import type { PoolNetwork } from "@/lib/spot/pool-candles";
import { terminalKindOf } from "@/lib/terminal-kind";
import { useSpotView } from "@/components/terminal/use-book-spot";
import { arcusConfig } from "@/lib/venues/arcus/config";
import { isEvmRef, isNativeToken, wrappedNative } from "@/lib/venues/uniswap/chains";

/** The token /swap or /spot actually trades for the selected asset, with what the chart header shows about it. */
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
 * On /spot: the Hyperliquid or Lighter spot market the view trades (its own candles), or its Arcus stock token. On
 * /swap: the traded token (a Uniswap token picked in the search, else Jupiter's, which the order panel resolves the
 * same way: BTC → the most traded BTC token), live numbers from the spot pairs list. null outside those views or when
 * nothing lists the asset; undefined while resolving.
 */
export function useSpotChartToken(): SpotChartToken | null | undefined {
  const kind = terminalKindOf(usePathname());
  const isSpot = kind === "spot";
  const isBook = kind === "book";
  // /spot: the order-book market or Arcus stock token the view trades.
  const spotView = useSpotView();
  const { symbol, mint } = useSelectedAsset();
  const { preferences } = usePreferences();
  const jupiter = useSpotToken(symbol, mint, isSpot && preferences.venueJupiter);
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
  const arcusToken = (token: { address: string; symbol: string; name: string }): SpotChartToken => {
    const listing = listings?.find((entry) => entry.id === `arcus:${token.address}`);
    return {
      network: arcusConfig.network === "mainnet" ? "robinhood" : null,
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      venue: "Arcus",
      price: listing?.price,
      change24h: listing?.change24h,
    };
  };
  if (isBook) return spotView === undefined ? undefined : spotView === null ? null : spotView.mode === "book" ? bookToken(spotView.ref) : arcusToken(spotView.token);
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
  return null;
}
