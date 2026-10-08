"use client";

import { CoinIcon } from "./token-icon";

/** Logo source (site favicon through /api/favicon) and chain badge for each venue label a row can carry. */
export const VENUE_MARKS: Record<string, { domain: string; chain?: number | string }> = {
  Hyperliquid: { domain: "hyperliquid.xyz" },
  Lighter: { domain: "lighter.xyz" },
  "Lighter RH": { domain: "lighter.xyz", chain: 4663 },
  Jupiter: { domain: "jup.ag", chain: "solana" },
  Arcus: { domain: "arcus.xyz", chain: 4663 },
  Uniswap: { domain: "uniswap.org" },
  Aster: { domain: "asterdex.com" },
  Orderly: { domain: "orderly.network" },
  Titan: { domain: "titan.exchange", chain: "solana" },
  "0x": { domain: "0x.org" },
  KyberSwap: { domain: "kyberswap.com" },
  Binance: { domain: "binance.com" },
  Bybit: { domain: "bybit.com" },
};

/** A venue's logo, served by our own favicon proxy (same origin, so a canvas can draw it); null without one. */
export function venueLogoUrl(name: string) {
  const mark = VENUE_MARKS[name];
  return mark ? `/api/favicon?domain=${mark.domain}` : null;
}

/** One venue's logo (with its chain badge), the name on hover; the name as text when it has no logo. */
export function VenueLogo({ name, size = 18 }: { name: string; size?: number }) {
  const mark = VENUE_MARKS[name];
  if (!mark) return <span className="rounded bg-app-chip px-1 text-[10px] font-semibold text-app-muted">{name}</span>;
  return (
    <span title={name} className="inline-flex shrink-0">
      <CoinIcon src={`/api/favicon?domain=${mark.domain}`} symbol={name} chain={mark.chain} size={size} />
    </span>
  );
}
