"use client";

import { useEffect, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { formatPrice } from "@/lib/format";
import { liquidationDistancePct } from "@/lib/trading/order-math";
import { summarizeVenue, totalSummary, type VenueSummary } from "@/lib/trading/portfolio";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId, VenueOpenOrder, VenuePosition } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useWallet } from "./wallet-provider";

type Tab = "positions" | "orders" | "venues";

const ARM_MS = 5_000;

const th = "px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint";
const tdBase = "px-3 py-1.5 tabular-nums";
const td = `${tdBase} text-app-ink`;

function signed(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatPrice(Math.abs(value))}`;
}

function RowButton({ onClick, children }: { onClick: () => Promise<void>; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onClick();
        setBusy(false);
      }}
      className="h-7 rounded-md border border-app-hairline-strong bg-app-chip px-2.5 text-[12px] font-semibold text-app-ink hover:bg-app-card disabled:opacity-50"
    >
      {busy ? "…" : children}
    </button>
  );
}

/** Which venue a row lives on; close and cancel go to that venue. */
function VenueBadge({ venue }: { venue: PerpVenueId }) {
  return (
    <span
      title={PERP_VENUE_NAMES[venue]}
      className="ml-1.5 rounded bg-app-chip px-1 py-[2px] align-middle text-[9px] font-semibold uppercase tracking-[0.08em] text-app-muted"
    >
      {venue === "hyperliquid" ? "HL" : "Lighter"}
    </span>
  );
}

function SymbolCell({ symbol, coin }: { symbol: string; coin: string }) {
  const { selectAsset } = useSelectedAsset();
  return (
    <button type="button" onClick={() => selectAsset(symbol)} className="inline-flex items-center gap-2 font-semibold hover:underline" title={coin}>
      <MarketIcon symbol={symbol} size={18} />
      {symbol}
    </button>
  );
}

/** A destructive button that needs a second press within a few seconds. */
function ConfirmButton({ label, confirmLabel, onConfirm, disabled }: { label: string; confirmLabel: string; onConfirm: () => Promise<void>; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setArmed(false);
        setBusy(true);
        await onConfirm();
        setBusy(false);
      }}
      className={`h-7 rounded-md border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
        armed ? "border-app-down bg-app-down text-white" : "border-app-hairline-strong bg-app-chip text-app-ink hover:bg-app-card"
      }`}
    >
      {busy ? "Closing…" : armed ? confirmLabel : label}
    </button>
  );
}

/** Closes positions one after another (each venue confirms its own fills). */
function useCloseAll() {
  const { closePosition } = useTrading();
  return async (positions: VenuePosition[]) => {
    for (const position of positions) await closePosition(position);
  };
}

function PositionsTable({ positions }: { positions: VenuePosition[] }) {
  const { closePosition, marketsByVenue } = useTrading();
  const markOf = (position: VenuePosition) => {
    const list = marketsByVenue[position.venue];
    const market = list ? findMarket(list, position.coin) : null;
    return market?.markPx ?? market?.midPx;
  };
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 bg-app-card">
        <tr>
          <th className={th}>Asset</th>
          <th className={th}>Size</th>
          <th className={th}>Value</th>
          <th className={th}>Entry</th>
          <th className={th}>Liq. (distance)</th>
          <th className={th}>PnL (ROE)</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => {
          const isLong = position.size > 0;
          return (
            <tr key={`${position.venue}:${position.coin}`} className="border-t border-app-hairline">
              <td className={td}>
                <SymbolCell symbol={position.symbol} coin={position.coin} />
                <VenueBadge venue={position.venue} />
                <span className="ml-1.5 text-app-faint">
                  {position.leverage}x {position.leverageType}
                </span>
              </td>
              <td className={`${tdBase} ${isLong ? "text-app-up" : "text-app-down"}`}>
                {isLong ? "Long " : "Short "}
                {Math.abs(position.size)}
              </td>
              <td className={td}>{formatPrice(position.positionValue)}</td>
              <td className={td}>{formatPrice(position.entryPx)}</td>
              <td className={td}>
                {position.liquidationPx ? formatPrice(position.liquidationPx) : "—"}
                {(() => {
                  const distance = liquidationDistancePct(markOf(position), position.liquidationPx);
                  if (distance === null) return null;
                  return (
                    <span className={`ml-1.5 ${distance < 10 ? "font-semibold text-app-down" : "text-app-faint"}`} title="Distance from the mark price">
                      {distance.toFixed(1)}%
                    </span>
                  );
                })()}
              </td>
              <td className={`${tdBase} ${position.unrealizedPnl >= 0 ? "text-app-up" : "text-app-down"}`}>
                {signed(position.unrealizedPnl)} ({(position.returnOnEquity * 100).toFixed(2)}%)
              </td>
              <td className={`${td} text-right`}>
                <RowButton onClick={() => closePosition(position)}>Close</RowButton>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OrdersTable({ orders }: { orders: VenueOpenOrder[] }) {
  const { cancelOrder } = useTrading();
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 bg-app-card">
        <tr>
          <th className={th}>Asset</th>
          <th className={th}>Type</th>
          <th className={th}>Side</th>
          <th className={th}>Price</th>
          <th className={th}>Size</th>
          <th className={th}>Placed</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={`${order.venue}:${order.oid}`} className="border-t border-app-hairline">
            <td className={td}>
              <SymbolCell symbol={order.symbol} coin={order.coin} />
              <VenueBadge venue={order.venue} />
            </td>
            <td className={td}>
              {order.orderType}
              {order.reduceOnly ? " · Reduce" : ""}
            </td>
            <td className={`${tdBase} ${order.side === "buy" ? "text-app-up" : "text-app-down"}`}>{order.side === "buy" ? "Buy" : "Sell"}</td>
            <td className={td}>{formatPrice(order.limitPx)}</td>
            <td className={td}>
              {order.size}
              {order.size !== order.origSize && <span className="text-app-faint"> / {order.origSize}</span>}
            </td>
            <td className={`${td} text-app-muted`}>{new Date(order.timestamp).toLocaleTimeString()}</td>
            <td className={`${td} text-right`}>
              <RowButton onClick={() => cancelOrder(order)}>Cancel</RowButton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VenuesTable({ rows, positions }: { rows: VenueSummary[]; positions: VenuePosition[] }) {
  const { network, lighterNetwork } = useTrading();
  const closeAll = useCloseAll();
  const total = totalSummary(rows);
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 bg-app-card">
        <tr>
          <th className={th}>Venue</th>
          <th className={th}>Account value</th>
          <th className={th}>Unrealized PnL</th>
          <th className={th}>Margin used</th>
          <th className={th}>Withdrawable</th>
          <th className={th}>Positions</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const venuePositions = positions.filter((position) => position.venue === row.venue);
          return (
            <tr key={row.venue} className="border-t border-app-hairline">
              <td className={`${td} font-semibold`}>
                {PERP_VENUE_NAMES[row.venue]}
                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-app-faint">
                  {(row.venue === "hyperliquid" ? network : lighterNetwork) === "testnet" ? "Testnet" : "Mainnet"}
                </span>
              </td>
              <td className={td}>{formatPrice(row.accountValue)}</td>
              <td className={`${tdBase} ${row.unrealizedPnl >= 0 ? "text-app-up" : "text-app-down"}`}>{signed(row.unrealizedPnl)}</td>
              <td className={td}>{formatPrice(row.marginUsed)}</td>
              <td className={td}>{formatPrice(row.withdrawable)}</td>
              <td className={td}>
                {row.positions}
                {row.orders > 0 && <span className="text-app-faint"> · {row.orders} orders</span>}
              </td>
              <td className={`${td} text-right`}>
                {venuePositions.length > 0 && (
                  <ConfirmButton label="Close all" confirmLabel={`Close ${venuePositions.length}?`} onConfirm={() => closeAll(venuePositions)} />
                )}
              </td>
            </tr>
          );
        })}
        {rows.length > 1 && (
          <tr className="border-t border-app-hairline-strong font-semibold">
            <td className={td}>Total</td>
            <td className={td}>{formatPrice(total.accountValue)}</td>
            <td className={`${tdBase} ${total.unrealizedPnl >= 0 ? "text-app-up" : "text-app-down"}`}>{signed(total.unrealizedPnl)}</td>
            <td className={td}>{formatPrice(total.marginUsed)}</td>
            <td className={td}>{formatPrice(total.withdrawable)}</td>
            <td className={td}>{total.positions}</td>
            <td className={td} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

type VenueFilter = PerpVenueId | "all";

/**
 * The portfolio across every perp venue (each venue's WebSocket feed): positions and open orders merged with a venue
 * badge and filter, a per-venue summary, and close-all actions behind a confirm press.
 */
export function PositionsBar() {
  const [tab, setTab] = useState<Tab>("positions");
  const [filter, setFilter] = useState<VenueFilter>("all");
  const { address } = useWallet();
  const { account, accounts } = useTrading();
  const closeAll = useCloseAll();
  const summaries = (Object.keys(accounts) as PerpVenueId[]).flatMap((venue) => {
    const snapshot = accounts[venue];
    return snapshot ? [summarizeVenue(venue, snapshot)] : [];
  });
  const total = totalSummary(summaries);
  const matches = (venue: PerpVenueId) => filter === "all" || venue === filter;
  const allPositions = account?.positions ?? [];
  const positions = allPositions.filter((position) => matches(position.venue));
  const orders = (account?.orders ?? []).filter((order) => matches(order.venue));
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "positions", label: "Positions", count: positions.length },
    { id: "orders", label: "Open orders", count: orders.length },
    { id: "venues", label: "Venues", count: summaries.length },
  ];
  const rows = tab === "positions" ? positions.length : tab === "orders" ? orders.length : summaries.length;

  return (
    <section
      aria-label="Account"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <div role="tablist" className="flex shrink-0 items-center gap-4 border-b border-app-hairline px-3">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px h-9 border-b-2 text-[12px] font-semibold transition-colors ${
              tab === id ? "border-app-accent text-app-ink" : "border-transparent text-app-muted hover:text-app-ink"
            }`}
          >
            {label}
            <span className="ml-1.5 tabular-nums text-app-faint">{count}</span>
          </button>
        ))}
        {summaries.length > 1 && tab !== "venues" && (
          <div role="group" aria-label="Venue filter" className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
            {(["all", ...summaries.map((row) => row.venue)] as VenueFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`h-6 rounded-md px-2 text-[11px] font-semibold ${filter === value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"}`}
              >
                {value === "all" ? "All" : PERP_VENUE_NAMES[value]}
              </button>
            ))}
          </div>
        )}
        {account && (
          <span className="ml-auto flex items-center gap-3 text-[12px] tabular-nums text-app-muted">
            <span>
              Equity <span className="text-app-ink">{formatPrice(total.accountValue)}</span>
            </span>
            <span>
              PnL <span className={total.unrealizedPnl >= 0 ? "text-app-up" : "text-app-down"}>{signed(total.unrealizedPnl)}</span>
            </span>
            <span>
              Withdrawable <span className="text-app-ink">{formatPrice(total.withdrawable)}</span>
            </span>
            {tab === "positions" && positions.length > 0 && (
              <ConfirmButton
                label={filter === "all" ? "Close all" : `Close all on ${PERP_VENUE_NAMES[filter]}`}
                confirmLabel={`Close ${positions.length}?`}
                onConfirm={() => closeAll(positions)}
              />
            )}
          </span>
        )}
      </div>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
        {!address ? (
          <p className="flex h-full items-center justify-center text-[12px] text-app-muted">Connect a wallet to see your portfolio across venues.</p>
        ) : !account ? (
          <p className="flex h-full items-center justify-center text-[12px] text-app-muted">Connecting to live account data…</p>
        ) : rows === 0 ? (
          <p className="flex h-full items-center justify-center text-[12px] text-app-muted">
            {tab === "positions" ? "No open positions." : tab === "orders" ? "No open orders." : "No venue data yet."}
          </p>
        ) : tab === "positions" ? (
          <PositionsTable positions={positions} />
        ) : tab === "orders" ? (
          <OrdersTable orders={orders} />
        ) : (
          <VenuesTable rows={summaries} positions={allPositions} />
        )}
      </div>
    </section>
  );
}
