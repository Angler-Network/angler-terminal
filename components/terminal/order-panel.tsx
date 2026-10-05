"use client";

import { useEffect, useState } from "react";
import { PerpOrderPanel } from "./perp-order-panel";
import { useSelectedAsset } from "./selected-asset";
import { SpotOrderPanel } from "./spot-order-panel";
import { useTrading } from "./trading-provider";
import { useSpotToken } from "./use-spot-token";

type VenueChoice = "perp" | "spot";

/**
 * Venue resolver for the selected asset: Hyperliquid perps when listed, Jupiter spot when a verified Solana token
 * exists. A mint from the news item points straight at spot. Tabs appear when both are available.
 */
export function OrderPanel() {
  const { symbol, mint } = useSelectedAsset();
  const { market } = useTrading();
  const token = useSpotToken(symbol, mint);
  const [choice, setChoice] = useState<VenueChoice | null>(null);

  useEffect(() => setChoice(null), [symbol, mint]);

  const hasPerp = Boolean(market);
  const hasSpot = Boolean(token);
  const preferred: VenueChoice = mint && hasSpot ? "spot" : hasPerp ? "perp" : hasSpot ? "spot" : "perp";
  const active = choice && (choice === "perp" ? hasPerp : hasSpot) ? choice : preferred;

  const tabs =
    hasPerp && hasSpot ? (
      <div role="tablist" aria-label="Venue" className="flex shrink-0 gap-1 border-b border-app-hairline px-3 py-1.5">
        {(
          [
            ["perp", "Perp · Hyperliquid"],
            ["spot", "Spot · Jupiter"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={active === value}
            onClick={() => setChoice(value)}
            className={`h-7 flex-1 rounded-md text-[12px] font-semibold ${
              active === value ? "bg-app-chip text-app-ink" : "text-app-muted hover:text-app-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    ) : null;

  if (active === "spot" && token) return <SpotOrderPanel key={token.mint} token={token} venueTabs={tabs} />;
  return <PerpOrderPanel venueTabs={tabs} />;
}
