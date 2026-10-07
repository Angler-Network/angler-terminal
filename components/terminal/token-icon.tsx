"use client";

import { useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";

/** Self-hosted logos (`public/tokens`, `public/chains`) of the stablecoins and chains the terminal moves between. */
const STABLE_LOGOS: Record<string, string> = { USDC: "/tokens/usdc.png", USDG: "/tokens/usdg.png", mUSDG: "/tokens/usdg.png" };
const CHAIN_LOGOS: Record<string, string> = {
  42161: "/chains/arbitrum.svg",
  8453: "/chains/base.svg",
  4663: "/chains/robinhood.svg",
  46630: "/chains/robinhood.svg",
  solana: "/chains/solana.svg",
  hyperliquid: "/chains/hyperliquid.svg",
};

export function stableLogo(symbol: string) {
  return STABLE_LOGOS[symbol];
}

/**
 * A token's logo (its own image, a known stablecoin's, else the asset icon the rest of the terminal shows) with its
 * chain's logo in the corner.
 */
export function CoinIcon({
  src,
  symbol,
  kind,
  chain,
  size = 18,
}: {
  src?: string;
  symbol: string;
  kind?: "crypto" | "stock";
  /** A chain id, or "solana" / "hyperliquid". */
  chain?: number | string;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const wanted = src ?? STABLE_LOGOS[symbol];
  // A token image that doesn't load falls back to the asset icon (itself falling back to the ticker's initials).
  const image = wanted && failed !== wanted ? wanted : undefined;
  const badge = chain !== undefined ? CHAIN_LOGOS[String(chain)] : undefined;
  const corner = Math.round(size * 0.5);
  return (
    <span aria-hidden className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {image ? (
        <img
          src={image}
          alt=""
          width={size}
          height={size}
          onError={() => setFailed(image)}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <MarketIcon symbol={symbol} kind={kind} size={size} />
      )}
      {badge && (
        <img
          src={badge}
          alt=""
          width={corner}
          height={corner}
          className="absolute -bottom-0.5 -right-1 rounded-full ring-2 ring-app-dialog"
          style={{ width: corner, height: corner }}
        />
      )}
    </span>
  );
}
