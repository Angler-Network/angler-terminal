"use client";

import { useEffect } from "react";
import { useTradeTicket } from "@/components/terminal/trade-ticket";
import { useAssetVenues } from "@/components/terminal/use-asset-venue";
import { sideLabel, type TradeVenueKind } from "@/lib/trading/presets";
import type { Direction } from "@/lib/types";
import type { OrderSide } from "@/lib/venues/types";

export interface ResolvedNewsTrade {
  symbol: string;
  mint?: string;
  venue: TradeVenueKind;
}

interface NewsTradeButtonsProps {
  newsId: string;
  symbol: string;
  mint?: string;
  /** The news item's predicted direction for this asset; highlights a side but never trades by itself. */
  direction: Direction;
  /** Reports the resolved venue so keyboard shortcuts can trade the selected item. */
  onResolved?: (newsId: string, trade: ResolvedNewsTrade | null) => void;
}

// Full class names so Tailwind generates them.
const tones = {
  buy: { armed: "bg-app-up text-white ring-2 ring-app-up/40", suggested: "bg-app-up/15 text-app-up hover:bg-app-up/25" },
  sell: { armed: "bg-app-down text-white ring-2 ring-app-down/40", suggested: "bg-app-down/15 text-app-down hover:bg-app-down/25" },
} as const;

/** Long/Short (Hyperliquid) or Buy/Sell (Jupiter) next to a news asset chip. Hidden when no venue supports it. */
export function NewsTradeButtons({ newsId, symbol, mint, direction, onResolved }: NewsTradeButtonsProps) {
  const venues = useAssetVenues(symbol, mint);
  const { ticket, arm } = useTradeTicket();
  const venue = venues?.preferred ?? null;

  useEffect(() => {
    if (venues === undefined) return;
    onResolved?.(newsId, venue ? { symbol, mint, venue } : null);
  }, [newsId, symbol, mint, venue, venues, onResolved]);

  if (!venue) return null;
  const suggested: OrderSide = direction === "up" ? "buy" : "sell";

  return (
    <span className="inline-flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      {(["buy", "sell"] as const).map((side) => {
        const isArmed = ticket?.newsId === newsId && ticket.side === side && ticket.symbol === symbol && ticket.confirmNonce === 0;
        const isSuggested = side === suggested;
        const label = sideLabel(venue, side);
        return (
          <button
            key={side}
            type="button"
            onClick={() => arm({ symbol, mint, venue, side, newsId })}
            title={`${isArmed ? "Confirm" : label} ${symbol} on ${venue === "perp" ? "Hyperliquid" : "Jupiter"}${isSuggested ? " (suggested by the news direction)" : ""}`}
            aria-pressed={isArmed}
            className={`h-6 rounded-md px-2 text-[11px] font-semibold transition-colors ${
              isArmed ? tones[side].armed : isSuggested ? tones[side].suggested : "text-app-muted hover:bg-app-chip hover:text-app-ink"
            }`}
          >
            {isArmed ? `Confirm ${label}` : label}
          </button>
        );
      })}
    </span>
  );
}
