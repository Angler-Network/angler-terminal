"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MarketIcon } from "@/components/app/market-icon";
import { RangeSlider } from "@/components/app/range-slider";
import { useModalEnter } from "@/components/app/use-motion";
import { formatPrice } from "@/lib/format";
import { optionalPrice, percentFrom, pnlAt, portionOf, tpslError } from "@/lib/trading/tpsl";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { VenuePosition } from "@/lib/venues/types";
import { useTrading } from "./trading-provider";

const STOPS = [25, 50, 75, 100];

const field =
  "h-9 w-full rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] tabular-nums text-app-ink outline-hidden focus:border-app-ink";

function signedUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatPrice(Math.abs(value))}`;
}

/** The position's market on its venue: lot size and mark price. */
function usePositionMarket(position: VenuePosition) {
  const { marketsByVenue } = useTrading();
  const list = marketsByVenue[position.venue];
  return list ? findMarket(list, position.coin) : null;
}

function DialogFrame({ title, position, onClose, children }: { title: string; position: VenuePosition; onClose: () => void; children: React.ReactNode }) {
  const backdropRef = useModalEnter(true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const isLong = position.size > 0;
  // Portaled: the row that opens it lives inside a <tbody>.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" ref={backdropRef} role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} ${position.symbol}`}
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-2.5">
          <MarketIcon symbol={position.symbol} size={28} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-app-ink">
              {title} {position.symbol}
            </h2>
            <p className="text-[12px] tabular-nums text-app-muted">
              <span className={isLong ? "text-app-up" : "text-app-down"}>
                {isLong ? "Long" : "Short"} {Math.abs(position.size)}
              </span>{" "}
              · entry {formatPrice(position.entryPx)} · {PERP_VENUE_NAMES[position.venue]}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** How much of the position: a slider with 25/50/75/100% stops and the resulting size. */
function AmountPicker({ percent, onPercent, amount, symbol }: { percent: number; onPercent: (value: number) => void; amount: number | undefined; symbol: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[11px] text-app-muted">
        Amount
        <span className="tabular-nums text-app-ink">
          {amount ?? 0} {symbol} <span className="text-app-faint">({percent}%)</span>
        </span>
      </span>
      <RangeSlider label="Percent of the position" min={1} max={100} value={percent} marks={STOPS} onChange={onPercent} />
      <div className="grid grid-cols-4 gap-1">
        {STOPS.map((stop) => (
          <button
            key={stop}
            type="button"
            aria-pressed={percent === stop}
            onClick={() => onPercent(stop)}
            className={`h-7 rounded-md text-[12px] font-semibold tabular-nums transition-colors ${
              percent === stop ? "bg-app-chip text-app-ink" : "text-app-muted hover:bg-app-chip/60 hover:text-app-ink"
            }`}
          >
            {stop}%
          </button>
        ))}
      </div>
    </div>
  );
}

/** Closes all or part of a position, at market or with a reduce-only limit order. */
export function ClosePositionDialog({ position, onClose }: { position: VenuePosition; onClose: () => void }) {
  const { closePosition, placeOrder } = useTrading();
  const market = usePositionMarket(position);
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [percent, setPercent] = useState(100);
  const [limitPx, setLimitPx] = useState(() => String(market?.midPx ?? market?.markPx ?? ""));
  const [busy, setBusy] = useState(false);
  const whole = Math.abs(position.size);
  const amount = portionOf(whole, percent, market?.szDecimals ?? 8);
  const mark = market?.markPx ?? market?.midPx;
  const exit = kind === "limit" ? optionalPrice(limitPx) : mark;
  const side = position.size > 0 ? "buy" : "sell";
  const pnl = amount && exit && Number.isFinite(exit) ? pnlAt(side, position.entryPx, exit, amount) : null;
  const invalid = !amount || (kind === "limit" && !(exit && exit > 0)) || (kind === "limit" && !market);

  const submit = async () => {
    if (invalid || busy) return;
    setBusy(true);
    if (kind === "market") {
      await closePosition(position, percent >= 100 ? undefined : amount);
      setBusy(false);
      onClose();
      return;
    }
    const placed = await placeOrder({ market: market!, side: side === "buy" ? "sell" : "buy", kind: "limit", size: amount!, limitPx: exit!, reduceOnly: true });
    setBusy(false);
    if (placed) onClose();
  };

  return (
    <DialogFrame title="Close" position={position} onClose={onClose}>
      <div role="group" aria-label="Close with" className="grid grid-cols-2 gap-0.5 rounded-lg bg-app-chip p-0.5">
        {(["market", "limit"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={`h-7 rounded-md text-[12px] font-semibold ${kind === value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
          >
            {value === "market" ? "Market" : "Limit"}
          </button>
        ))}
      </div>
      {kind === "limit" && (
        <label className="flex flex-col gap-1 text-[11px] text-app-muted">
          <span className="flex items-center justify-between">
            Price
            {market && (market.midPx ?? market.markPx) && (
              <button type="button" onClick={() => setLimitPx(String(market.midPx ?? market.markPx))} className="font-semibold text-app-accent hover:underline">
                Mid
              </button>
            )}
          </span>
          <input aria-label="Limit price" className={field} inputMode="decimal" value={limitPx} onChange={(event) => setLimitPx(event.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
      )}
      <AmountPicker percent={percent} onPercent={setPercent} amount={amount} symbol={position.symbol} />
      <div className="flex flex-col gap-1 border-t border-app-hairline pt-2.5 text-[12px]">
        <span className="flex justify-between text-app-muted">
          {kind === "market" ? "Mark price" : "Close price"}
          <span className="tabular-nums text-app-ink">{exit && Number.isFinite(exit) ? formatPrice(exit) : "—"}</span>
        </span>
        <span className="flex justify-between text-app-muted">
          Est. PnL on this part
          <span className={`tabular-nums ${pnl === null ? "text-app-ink" : pnl >= 0 ? "text-app-up" : "text-app-down"}`}>{pnl === null ? "—" : signedUsd(pnl)}</span>
        </span>
        {percent < 100 && amount && (
          <span className="flex justify-between text-app-muted">
            Left open
            <span className="tabular-nums text-app-ink">
              {Number((whole - amount).toFixed(market?.szDecimals ?? 8))} {position.symbol}
            </span>
          </span>
        )}
      </div>
      <button
        type="button"
        disabled={invalid || busy}
        onClick={() => void submit()}
        className="h-10 rounded-lg bg-app-down/90 text-[13px] font-semibold text-white hover:bg-app-down disabled:opacity-50"
      >
        {busy ? "Closing…" : `${kind === "market" ? "Close" : "Place limit close for"} ${percent >= 100 ? "all" : `${amount ?? 0} ${position.symbol}`}`}
      </button>
    </DialogFrame>
  );
}

/** Take profit / stop loss for all or part of an open position, with the position's existing triggers listed. */
export function TpslDialog({ position, onClose }: { position: VenuePosition; onClose: () => void }) {
  const { setPositionTpsl, account, cancelOrder } = useTrading();
  const market = usePositionMarket(position);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [percent, setPercent] = useState(100);
  const [busy, setBusy] = useState(false);
  const side = position.size > 0 ? "buy" : "sell";
  const whole = Math.abs(position.size);
  const amount = portionOf(whole, percent, market?.szDecimals ?? 8);
  const mark = market?.markPx ?? market?.midPx;
  const tp = optionalPrice(takeProfit);
  const sl = optionalPrice(stopLoss);
  // Levels are checked against the current price: a TP below the mark on a long would trigger at once.
  const error = tpslError({ side, reference: mark ?? position.entryPx, takeProfit: tp, stopLoss: sl });
  const existing = (account?.orders ?? []).filter((order) => order.venue === position.venue && order.coin === position.coin && order.reduceOnly);

  const hint = (level: number | undefined) => {
    if (level === undefined || !Number.isFinite(level) || !amount) return "";
    const pnl = pnlAt(side, position.entryPx, level, amount);
    const move = percentFrom(position.entryPx, level);
    return (
      <span className={pnl >= 0 ? "text-app-up" : "text-app-down"}>
        {move >= 0 ? "+" : ""}
        {move.toFixed(2)}% · {signedUsd(pnl)}
      </span>
    );
  };

  const submit = async () => {
    if (busy || error || !amount || (tp === undefined && sl === undefined)) return;
    setBusy(true);
    const ok = await setPositionTpsl(position, { takeProfit: tp, stopLoss: sl, size: percent >= 100 ? undefined : amount });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <DialogFrame title="TP/SL" position={position} onClose={onClose}>
      {mark && <p className="-mt-1 text-[12px] tabular-nums text-app-faint">Mark {formatPrice(mark)}</p>}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { label: "Take profit", value: takeProfit, set: setTakeProfit, level: tp },
            { label: "Stop loss", value: stopLoss, set: setStopLoss, level: sl },
          ] as const
        ).map((entry) => (
          <label key={entry.label} className="flex flex-col gap-1 text-[11px] text-app-muted">
            {entry.label}
            <input
              aria-label={`${entry.label} price`}
              className={field}
              inputMode="decimal"
              placeholder="Price"
              value={entry.value}
              onChange={(event) => entry.set(event.target.value.replace(/[^0-9.]/g, ""))}
            />
            <span className="h-3.5 text-[11px] tabular-nums">{hint(entry.level)}</span>
          </label>
        ))}
      </div>
      <AmountPicker percent={percent} onPercent={setPercent} amount={amount} symbol={position.symbol} />
      {percent < 100 && (
        <p className="text-[11px] text-app-faint">Covers part of the position: add another TP/SL for the rest at other prices.</p>
      )}
      {error && <p className="text-[11px] text-app-down">{error}</p>}
      <button
        type="button"
        disabled={busy || Boolean(error) || !amount || (tp === undefined && sl === undefined)}
        onClick={() => void submit()}
        className="h-10 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent disabled:opacity-50"
      >
        {busy ? "Placing…" : percent >= 100 ? "Place TP/SL" : `Place TP/SL for ${amount ?? 0} ${position.symbol}`}
      </button>
      {existing.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-app-hairline pt-2.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint">Active on this position</span>
          {existing.map((order) => (
            <div key={order.oid} className="flex items-center gap-2 text-[12px] tabular-nums">
              <span className="min-w-0 flex-1 truncate text-app-muted">{order.orderType}</span>
              <span className="text-app-ink">{formatPrice(order.limitPx)}</span>
              <span className="w-16 text-right text-app-faint">{order.size || "all"}</span>
              <button type="button" onClick={() => void cancelOrder(order)} className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-app-muted hover:bg-app-chip hover:text-app-ink">
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </DialogFrame>
  );
}
