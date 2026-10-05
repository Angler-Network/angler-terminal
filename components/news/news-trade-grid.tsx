"use client";

import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { ticketKey, useTradeTicket } from "@/components/terminal/trade-ticket";
import { useAssetVenues } from "@/components/terminal/use-asset-venue";
import { useMarketQuote } from "@/components/terminal/use-market-quote";
import { formatPercent } from "@/lib/format";
import { presetLabel, sideLabel, sizePresets, type TradeVenueKind } from "@/lib/trading/presets";
import type { Direction } from "@/lib/types";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { OrderSide, PerpVenueId, SpotVenueId } from "@/lib/venues/types";
import { SymbolChip } from "./symbol-chip";

export interface ResolvedNewsTrade {
  symbol: string;
  mint?: string;
  venue: TradeVenueKind;
  /** Perp venue the resolver picked (preferred, else the fallback). */
  perpVenue?: PerpVenueId;
  spotVenue?: SpotVenueId;
}

export interface GridAsset {
  symbol: string;
  direction: Direction;
  mint?: string;
}

// Full class names so Tailwind generates them. The side the news points to is drawn stronger.
const sideStyles = {
  buy: {
    suggested: "border-app-up/40 bg-app-up/20 text-app-up hover:bg-app-up/30",
    other: "border-app-up/15 bg-app-up/5 text-app-up/70 hover:bg-app-up/15",
    armed: "border-app-up bg-app-up text-white",
  },
  sell: {
    suggested: "border-app-down/40 bg-app-down/20 text-app-down hover:bg-app-down/30",
    other: "border-app-down/15 bg-app-down/5 text-app-down/70 hover:bg-app-down/15",
    armed: "border-app-down bg-app-down text-white",
  },
} as const;

function Change({ symbol }: { symbol: string }) {
  const quote = useMarketQuote(symbol);
  if (!quote) return null;
  const isUp = quote.changePct >= 0;
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${isUp ? "text-app-up" : "text-app-down"}`} title="24h change">
      {isUp ? "+" : "-"}
      {formatPercent(quote.changePct)}
    </span>
  );
}

function AssetRow({
  newsId,
  asset,
  onResolved,
  onSelectAsset,
}: {
  newsId: string;
  asset: GridAsset;
  onResolved: (newsId: string, symbol: string, trade: ResolvedNewsTrade | null) => void;
  onSelectAsset: (symbol: string, mint?: string) => void;
}) {
  const venues = useAssetVenues(asset.symbol, asset.mint);
  const venue = venues?.preferred ?? null;
  const perpVenue = venue === "perp" ? venues?.perp?.venue : undefined;
  const spotVenue = venue === "spot" ? venues?.spotVenue : undefined;
  const venueName = perpVenue ? `${PERP_VENUE_NAMES[perpVenue]} perp` : spotVenue === "arcus" ? "Arcus stock token" : "Jupiter spot";
  const { ticket, pendingKey, press } = useTradeTicket();

  useEffect(() => {
    if (venues !== undefined) onResolved(newsId, asset.symbol, venue ? { symbol: asset.symbol, mint: asset.mint, venue, perpVenue, spotVenue } : null);
  }, [venues, venue, perpVenue, spotVenue, newsId, asset.symbol, asset.mint, onResolved]);

  if (venues === undefined) {
    return <div className="h-[58px] animate-pulse rounded-lg bg-app-chip/50" aria-hidden />;
  }
  if (!venue) {
    // No venue lists it: keep the asset visible as a plain chip, without trade buttons.
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSelectAsset(asset.symbol, asset.mint);
        }}
        className="self-start rounded-md border border-app-hairline px-1.5 py-0.5 hover:bg-app-chip"
        title={`Show ${asset.symbol} on the chart (not tradable here)`}
      >
        <SymbolChip symbol={asset.symbol} direction={asset.direction} />
      </button>
    );
  }
  const suggested: OrderSide = asset.direction === "up" ? "buy" : "sell";

  return (
    <div className="grid grid-cols-[minmax(76px,auto)_1fr] items-center gap-x-2" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => onSelectAsset(asset.symbol, asset.mint)}
        title={`Show ${asset.symbol} on the chart · ${venueName}`}
        className="flex min-w-0 flex-col items-start gap-0.5 rounded-md px-1 py-0.5 text-left hover:bg-app-chip"
      >
        <span className="flex items-center gap-1.5">
          <MarketIcon symbol={asset.symbol} size={16} />
          <span className="text-[13px] font-semibold text-app-ink">{asset.symbol}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.06em] text-app-faint">
          {perpVenue ? `Perp · ${PERP_VENUE_NAMES[perpVenue]}` : spotVenue === "arcus" ? "Spot · Arcus" : "Spot"}
          <Change symbol={asset.symbol} />
        </span>
      </button>
      <div className="flex flex-col gap-1">
        {(["buy", "sell"] as const).map((side) => (
          <div key={side} role="group" aria-label={`${sideLabel(venue, side)} ${asset.symbol}`} className="grid grid-cols-4 gap-1">
            {sizePresets[venue].map((size) => {
              const key = ticketKey({ newsId, symbol: asset.symbol, side, sizeUsd: size });
              const isArmed = ticket !== null && ticketKey(ticket) === key;
              const isPending = pendingKey === key;
              const style = sideStyles[side];
              return (
                <button
                  key={size}
                  type="button"
                  disabled={Boolean(pendingKey)}
                  onClick={() => press({ newsId, symbol: asset.symbol, mint: asset.mint, venue, perpVenue, spotVenue, side, sizeUsd: size })}
                  title={`${isArmed ? "Confirm: " : ""}${sideLabel(venue, side)} ${asset.symbol} $${size}${side === suggested ? " (matches the news direction)" : ""}`}
                  className={`flex h-7 items-center justify-center rounded-md border text-[12px] font-semibold tabular-nums transition-colors disabled:cursor-wait ${
                    isArmed || isPending ? style.armed : side === suggested ? style.suggested : style.other
                  }`}
                >
                  {isPending ? <Loader2 className="size-3.5 animate-spin" aria-label="Placing" /> : isArmed ? "Confirm" : presetLabel(size)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Size grid for each tradable asset on an important news card: Long/Buy row (green) and Short/Sell row (red).
 * Assets no venue supports get no row.
 */
export function NewsTradeGrid({
  newsId,
  assets,
  onResolved,
  onSelectAsset,
}: {
  newsId: string;
  assets: GridAsset[];
  onResolved: (newsId: string, symbol: string, trade: ResolvedNewsTrade | null) => void;
  onSelectAsset: (symbol: string, mint?: string) => void;
}) {
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {assets.map((asset) => (
        <AssetRow
          key={asset.symbol}
          newsId={newsId}
          asset={asset}
          onSelectAsset={onSelectAsset}
          onResolved={onResolved}
        />
      ))}
    </div>
  );
}
