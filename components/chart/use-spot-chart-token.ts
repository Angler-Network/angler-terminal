"use client";

import { usePathname } from "next/navigation";
import { usePreferences } from "@/components/app/preferences-provider";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useArcusToken } from "@/components/terminal/use-arcus-token";
import { useSpotListings } from "@/components/terminal/use-spot-listings";
import { useSpotToken } from "@/components/terminal/use-spot-token";
import type { PoolNetwork } from "@/lib/spot/pool-candles";
import { terminalKindOf } from "@/lib/terminal-kind";
import { arcusConfig } from "@/lib/venues/arcus/config";

/** The token /swap actually trades for the selected asset, with what the chart header shows about it. */
export interface SpotChartToken {
  /** Chain its pools live on; null when the on-chain data has no index for it (Arcus testnet). */
  network: PoolNetwork | null;
  address: string;
  symbol: string;
  name: string;
  icon?: string;
  venue: "Jupiter" | "Arcus";
  price?: number;
  change24h?: number;
  liquidity?: number;
  volume24h?: number;
  marketCap?: number;
}

/**
 * On /swap: the traded token (Jupiter's, which the order panel resolves the same way: BTC → the most traded BTC token;
 * else Arcus's stock token), live numbers from the spot pairs list. null outside /swap or when no spot venue lists the
 * asset; undefined while resolving.
 */
export function useSpotChartToken(): SpotChartToken | null | undefined {
  const isSpot = terminalKindOf(usePathname()) === "spot";
  const { symbol, mint } = useSelectedAsset();
  const { preferences } = usePreferences();
  const jupiter = useSpotToken(symbol, mint, isSpot && preferences.venueJupiter);
  const needArcus = isSpot && preferences.venueArcus && jupiter === null && !mint;
  const arcus = useArcusToken(symbol, needArcus);
  const listings = useSpotListings(isSpot);

  if (!isSpot) return null;
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
  if (!arcus) return null;
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
