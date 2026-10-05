"use client";

import { useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { formatPrice } from "@/lib/format";
import { sideLabel } from "@/lib/trading/presets";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import type { OrderSide, PerpVenueId, SpotToken, VenueMarket } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useNewsTrader } from "./use-news-trader";
import { useSpotToken } from "./use-spot-token";

type VenueChoice =
  | { id: PerpVenueId; name: string; network: string; kind: "perp"; market: VenueMarket }
  | { id: "jupiter"; name: string; network: string; kind: "spot"; token: SpotToken };

const ARM_MS = 5_000;
const DEFAULT_SIZE_USD = "11";

const inputClass =
  "h-8 w-full min-w-0 rounded-lg border border-app-field-border bg-app-field px-2 text-[13px] tabular-nums text-app-ink outline-none focus:border-app-ink";

/**
 * Test order form for the chart's asset: pick a venue, side, size (and leverage on perps) and place a market order
 * with the same code path as the news buttons. A press arms the order; the second press places it.
 */
export function ManualOrderSection() {
  const { symbol, mint } = useSelectedAsset();
  const { preferences } = usePreferences();
  const { marketsByVenue, network, lighterNetwork } = useTrading();
  const trade = useNewsTrader();
  const token = useSpotToken(symbol, mint, preferences.venueJupiter);

  const choices: VenueChoice[] = [];
  const hl = preferences.venueHyperliquid && marketsByVenue.hyperliquid ? findMarket(marketsByVenue.hyperliquid, symbol) : null;
  if (hl) choices.push({ id: "hyperliquid", name: "Hyperliquid", network, kind: "perp", market: hl });
  const lighter = preferences.venueLighter && marketsByVenue.lighter ? findMarket(marketsByVenue.lighter, symbol) : null;
  if (lighter) choices.push({ id: "lighter", name: "Lighter", network: lighterNetwork, kind: "perp", market: lighter });
  if (preferences.venueJupiter && token) choices.push({ id: "jupiter", name: "Jupiter", network: "mainnet", kind: "spot", token });

  const [venueId, setVenueId] = useState<VenueChoice["id"] | null>(null);
  const [side, setSide] = useState<OrderSide>("buy");
  const [size, setSize] = useState(DEFAULT_SIZE_USD);
  const [leverage, setLeverage] = useState(String(preferences.newsLeverage));
  const [armed, setArmed] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);

  const choice = choices.find((entry) => entry.id === venueId) ?? choices[0] ?? null;
  const sizeUsd = Number(size);
  const leverageValue = Math.floor(Number(leverage));
  const maxLeverage = choice?.kind === "perp" ? choice.market.maxLeverage : 1;
  const isValid = sizeUsd > 0 && (choice?.kind !== "perp" || (leverageValue >= 1 && leverageValue <= maxLeverage));
  const price = choice?.kind === "perp" ? (choice.market.midPx ?? choice.market.markPx) : undefined;

  // Any change disarms, and an armed order expires so a stale confirm can't fire later.
  useEffect(() => setArmed(false), [symbol, choice?.id, side, size, leverage]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const place = async () => {
    if (!choice || !isValid || isPlacing) return;
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setArmed(false);
    setIsPlacing(true);
    try {
      await trade({
        symbol,
        mint: choice.kind === "spot" ? choice.token.mint : undefined,
        venue: choice.kind,
        perpVenue: choice.kind === "perp" ? choice.id : undefined,
        side,
        sizeUsd,
        leverage: choice.kind === "perp" ? leverageValue : undefined,
        oneClick: preferences.oneClickTrading,
      });
    } finally {
      setIsPlacing(false);
    }
  };

  const kind = choice?.kind ?? "perp";
  const isBuy = side === "buy";

  return (
    <section className="flex flex-col gap-2 border-b border-app-hairline p-3">
      <header className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-app-muted">Test order · {symbol}</h3>
        {choice && (
          <span className="ml-auto rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">
            {choice.network}
          </span>
        )}
      </header>
      {choices.length === 0 ? (
        <p className="text-[12px] text-app-faint">
          {marketsByVenue.hyperliquid === undefined ? "Loading markets…" : `No enabled venue lists ${symbol}. Pick another asset on the chart.`}
        </p>
      ) : (
        <>
          <div role="group" aria-label="Venue" className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
            {choices.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={choice?.id === entry.id}
                onClick={() => setVenueId(entry.id)}
                className={`h-7 flex-1 rounded-md text-[12px] font-semibold transition-colors ${
                  choice?.id === entry.id ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"
                }`}
              >
                {entry.name}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Side" className="grid grid-cols-2 gap-1">
            {(["buy", "sell"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={side === value}
                onClick={() => setSide(value)}
                className={`h-8 rounded-lg border text-[12px] font-semibold transition-colors ${
                  side === value
                    ? value === "buy"
                      ? "border-app-up/60 bg-app-up/15 text-app-up"
                      : "border-app-down/60 bg-app-down/15 text-app-down"
                    : "border-app-hairline text-app-muted hover:text-app-ink"
                }`}
              >
                {sideLabel(kind, value)}
              </button>
            ))}
          </div>
          <div className={`grid gap-2 ${kind === "perp" ? "grid-cols-2" : "grid-cols-1"}`}>
            <label className="flex flex-col gap-1 text-[11px] text-app-muted">
              Size (USD)
              <input className={inputClass} inputMode="decimal" value={size} onChange={(event) => setSize(event.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            {kind === "perp" && (
              <label className="flex flex-col gap-1 text-[11px] text-app-muted">
                Leverage (max {maxLeverage}x)
                <input className={inputClass} inputMode="numeric" value={leverage} onChange={(event) => setLeverage(event.target.value.replace(/[^0-9]/g, ""))} />
              </label>
            )}
          </div>
          {price !== undefined && (
            <p className="text-[11px] text-app-faint">
              Market order near {formatPrice(price)} · {choice?.kind === "perp" ? choice.market.coin : symbol}
            </p>
          )}
          {kind === "spot" && <p className="text-[11px] text-app-faint">Jupiter swaps are on Solana mainnet with real funds.</p>}
          <button
            type="button"
            disabled={!isValid || isPlacing}
            onClick={() => void place()}
            className={`h-9 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 ${
              isBuy ? "bg-app-up/90 text-black hover:bg-app-up" : "bg-app-down/90 text-white hover:bg-app-down"
            } ${armed ? "ring-2 ring-app-ink ring-offset-1 ring-offset-transparent" : ""}`}
          >
            {isPlacing
              ? "Placing…"
              : armed
                ? `Confirm ${sideLabel(kind, side).toLowerCase()} $${sizeUsd}`
                : `${sideLabel(kind, side)} $${sizeUsd > 0 ? sizeUsd : 0} ${symbol}`}
          </button>
        </>
      )}
    </section>
  );
}
