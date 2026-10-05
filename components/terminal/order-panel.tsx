"use client";

import { useEffect, useState } from "react";
import { PerpOrderPanel } from "./perp-order-panel";
import { useSelectedAsset } from "./selected-asset";
import { SpotOrderPanel } from "./spot-order-panel";
import { useTradeTicket } from "./trade-ticket";
import { useAssetVenues } from "./use-asset-venue";

type VenueChoice = "perp" | "spot";

export const DISCLAIMER = "Not financial advice. Scores are model outputs.";

/**
 * Order panel for the selected asset, routed by the venue resolver (useAssetVenues). An armed news trade picks
 * its venue; otherwise the user can switch with tabs when both venues list the asset.
 */
export function OrderPanel() {
  const { symbol, mint } = useSelectedAsset();
  const { ticket } = useTradeTicket();
  const venues = useAssetVenues(symbol, mint, { needSpot: true });
  const [choice, setChoice] = useState<VenueChoice | null>(null);

  useEffect(() => setChoice(null), [symbol, mint]);

  const hasPerp = Boolean(venues?.perp);
  const hasSpot = Boolean(venues?.spot);
  const ticketVenue = ticket && ticket.symbol === symbol ? ticket.venue : null;
  const requested = ticketVenue ?? choice;
  const active: VenueChoice =
    requested && (requested === "perp" ? hasPerp : hasSpot) ? requested : (venues?.preferred ?? "perp");

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="min-h-0 flex-1">
        {active === "spot" && venues?.spot ? (
          <SpotOrderPanel key={venues.spot.mint} token={venues.spot} venueTabs={tabs} />
        ) : (
          <PerpOrderPanel venueTabs={tabs} />
        )}
      </div>
      <p className="shrink-0 px-1 text-center text-[10px] leading-tight text-app-faint">{DISCLAIMER}</p>
    </div>
  );
}
