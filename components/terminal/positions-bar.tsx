"use client";

import { Share2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { usePreferences } from "@/components/app/preferences-provider";
import { useListEnter } from "@/components/app/use-motion";
import { formatPrice } from "@/lib/format";
import { durations, ease, ENTER_PROPS } from "@/lib/motion";
import { liquidationDistancePct } from "@/lib/trading/order-math";
import { groupByVenue, summarizeVenue, totalSummary, type VenueSummary } from "@/lib/trading/portfolio";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId, VenueOpenOrder, VenuePosition } from "@/lib/venues/types";
import { ClosePositionDialog, TpslDialog } from "./position-dialogs";
import { VenueLogo } from "./market-rows";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useWallet } from "./wallet-provider";
import dynamic from "next/dynamic";
import { perpNetwork } from "@/lib/venues/perp-network";

// History loads its venue code on demand (the Hyperliquid SDK, Lighter's signer for the auth token).
const OrderHistoryTable = dynamic(() => import("./history-tables").then((module) => module.OrderHistoryTable), { ssr: false });
const SharePositionDialog = dynamic(() => import("./share-position-dialog").then((module) => module.SharePositionDialog), { ssr: false });
const PositionHistoryTable = dynamic(() => import("./history-tables").then((module) => module.PositionHistoryTable), { ssr: false });

type Tab = "positions" | "orders" | "orderHistory" | "positionHistory" | "venues";

const ARM_MS = 5_000;

// One line per cell: a narrow panel scrolls sideways instead of wrapping headers and pushing rows out of view.
export const th = "whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint";
const tdBase = "whitespace-nowrap px-3 py-1.5 tabular-nums";
export const td = `${tdBase} text-app-ink`;

export function signed(value: number) {
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

/** Which venue a row lives on, as its logo (the name on hover); close and cancel go to that venue. */
export function VenueBadge({ venue }: { venue: PerpVenueId }) {
  return (
    <span className="ml-2 inline-flex align-middle">
      <VenueLogo name={PERP_VENUE_NAMES[venue]} size={16} />
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

/** Header row for one venue's group: name, count, unrealized PnL and a close-all for that venue. */
function VenueGroupRow({ venue, count, noun, pnl, onCloseAll, colSpan }: { venue: PerpVenueId; count: number; noun: string; pnl?: number; onCloseAll?: () => Promise<void>; colSpan: number }) {
  return (
    <tr className="border-t border-app-hairline bg-app-chip/40">
      <td colSpan={colSpan} className="px-3 py-1.5">
        <span className="flex items-center gap-3 text-[11px]">
          <span className="font-semibold uppercase tracking-[0.06em] text-app-ink">{PERP_VENUE_NAMES[venue]}</span>
          <span className="tabular-nums text-app-faint">
            {count} {noun}
            {count === 1 ? "" : "s"}
          </span>
          {pnl !== undefined && <span className={`tabular-nums ${pnl >= 0 ? "text-app-up" : "text-app-down"}`}>{signed(pnl)}</span>}
          {/* Next to the totals, not right-aligned: a wide table scrolls sideways and would hide it. */}
          {onCloseAll && count > 1 && <ConfirmButton label="Close all" confirmLabel={`Close ${count}?`} onConfirm={onCloseAll} />}
        </span>
      </td>
    </tr>
  );
}

/** Whether rows spanning several venues should show under a header per venue (the user's choice, grouped by default). */
/** Positions and orders that open while the table is shown slide in, so a fill is easy to spot. */
function useRowEnter(keys: string[]) {
  const ref = useRef<HTMLTableElement>(null);
  useListEnter(ref, keys, "tr[data-motion-key]", (gsap, rows) =>
    gsap.from(rows, { opacity: 0, x: -10, duration: durations.base, ease: ease.out, stagger: 0.05, clearProps: ENTER_PROPS }),
  );
  return ref;
}

function useGrouped(rows: Array<{ venue: PerpVenueId }>) {
  const { preferences } = usePreferences();
  return preferences.positionsLayout === "grouped" && new Set(rows.map((row) => row.venue)).size > 1;
}

export function PositionsTable({ positions }: { positions: VenuePosition[] }) {
  // The position whose TP/SL or close dialog is open (a dialog, so the table doesn't shift under it).
  const [dialog, setDialog] = useState<{ kind: "tpsl" | "close"; key: string } | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const { marketsByVenue } = useTrading();
  const closeAll = useCloseAll();
  const grouped = useGrouped(positions);
  const tableRef = useRowEnter(positions.map((position) => `${position.venue}:${position.coin}`));
  const markOf = (position: VenuePosition) => {
    const list = marketsByVenue[position.venue];
    const market = list ? findMarket(list, position.coin) : null;
    return market?.markPx ?? market?.midPx;
  };
  return (
    <table ref={tableRef} className="w-full text-[12px]">
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
        {(grouped ? groupByVenue(positions) : [{ venue: null, rows: positions }]).map((group) => (
          <Fragment key={group.venue ?? "all"}>
        {group.venue && (
          <VenueGroupRow
            venue={group.venue}
            count={group.rows.length}
            noun="position"
            pnl={group.rows.reduce((sum, position) => sum + position.unrealizedPnl, 0)}
            onCloseAll={() => closeAll(group.rows)}
            colSpan={7}
          />
        )}
        {group.rows.map((position) => {
          const isLong = position.size > 0;
          const key = `${position.venue}:${position.coin}`;
          return (
            <Fragment key={key}>
            <tr data-motion-key={key} className="border-t border-app-hairline">
              <td className={td}>
                {/* One centered row: icon, symbol, venue and leverage line up with the rest of the position. */}
                <span className="flex items-center">
                  <SymbolCell symbol={position.symbol} coin={position.coin} />
                  {!grouped && <VenueBadge venue={position.venue} />}
                  <span className="ml-1.5 text-app-faint">
                    {position.leverage}x {position.leverageType}
                  </span>
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
                <span className="inline-flex gap-1.5">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setDialog({ kind: "tpsl", key })}
                    className="h-7 rounded-md border border-app-hairline-strong px-2.5 text-[12px] font-semibold text-app-muted hover:text-app-ink"
                  >
                    TP/SL
                  </button>
                  <button
                    type="button"
                    onClick={() => setSharing(key)}
                    title="Share PnL card"
                    aria-label={`Share ${position.symbol} PnL card`}
                    className="grid h-7 w-7 place-items-center rounded-md border border-app-hairline-strong text-app-muted hover:text-app-ink"
                  >
                    <Share2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setDialog({ kind: "close", key })}
                    className="h-7 rounded-md border border-app-hairline-strong bg-app-chip px-2.5 text-[12px] font-semibold text-app-ink hover:bg-app-card"
                  >
                    Close
                  </button>
                </span>
                {sharing === key && <SharePositionDialog position={position} onClose={() => setSharing(null)} />}
              </td>
            </tr>
            {dialog?.key === key &&
              (dialog.kind === "tpsl" ? (
                <TpslDialog position={position} onClose={() => setDialog(null)} />
              ) : (
                <ClosePositionDialog position={position} onClose={() => setDialog(null)} />
              ))}
            </Fragment>
          );
        })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function OrdersTable({ orders }: { orders: VenueOpenOrder[] }) {
  const { cancelOrder } = useTrading();
  const grouped = useGrouped(orders);
  const tableRef = useRowEnter(orders.map((order) => `${order.venue}:${order.oid}`));
  return (
    <table ref={tableRef} className="w-full text-[12px]">
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
        {(grouped ? groupByVenue(orders) : [{ venue: null, rows: orders }]).map((group) => (
          <Fragment key={group.venue ?? "all"}>
        {group.venue && <VenueGroupRow venue={group.venue} count={group.rows.length} noun="order" colSpan={7} />}
        {group.rows.map((order) => (
          <tr key={`${order.venue}:${order.oid}`} data-motion-key={`${order.venue}:${order.oid}`} className="border-t border-app-hairline">
            <td className={td}>
              <span className="flex items-center">
                <SymbolCell symbol={order.symbol} coin={order.coin} />
                {!grouped && <VenueBadge venue={order.venue} />}
              </span>
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
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function VenuesTable({ rows, positions }: { rows: VenueSummary[]; positions: VenuePosition[] }) {
  const { network } = useTrading();
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
                  {(row.venue === "hyperliquid" ? network : perpNetwork(row.venue)) === "testnet" ? "Testnet" : "Mainnet"}
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

/**
 * The portfolio across every perp venue (each venue's WebSocket feed): positions and open orders merged, grouped
 * under a header per venue once more than one venue has rows (or one list with venue badges, the user's choice),
 * a per-venue summary, and close-all actions behind a confirm press. No per-venue filter buttons: they don't scale
 * past a few venues.
 */
export function PositionsBar() {
  const [tab, setTab] = useState<Tab>("positions");
  const { address } = useWallet();
  const { account, accounts } = useTrading();
  const { preferences, updatePreference } = usePreferences();
  const closeAll = useCloseAll();
  const summaries = (Object.keys(accounts) as PerpVenueId[]).flatMap((venue) => {
    const snapshot = accounts[venue];
    return snapshot ? [summarizeVenue(venue, snapshot)] : [];
  });
  const total = totalSummary(summaries);
  const positions = account?.positions ?? [];
  const orders = account?.orders ?? [];
  const rowsOnScreen: Array<{ venue: PerpVenueId }> = tab === "positions" ? positions : tab === "orders" ? orders : [];
  const multiVenue = new Set(rowsOnScreen.map((row) => row.venue)).size > 1;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "positions", label: "Positions", count: positions.length },
    { id: "orders", label: "Open orders", count: orders.length },
    { id: "orderHistory", label: "Order history" },
    { id: "positionHistory", label: "Position history" },
    { id: "venues", label: "Venues", count: summaries.length },
  ];
  const isHistory = tab === "orderHistory" || tab === "positionHistory";
  const rows = tab === "positions" ? positions.length : tab === "orders" ? orders.length : isHistory ? 1 : summaries.length;

  return (
    <section
      aria-label="Account"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <div role="tablist" className="scrollbar-none flex shrink-0 items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-app-hairline px-3">
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
            {count !== undefined && <span className="ml-1.5 tabular-nums text-app-faint">{count}</span>}
          </button>
        ))}
        {multiVenue && (
          <div role="group" aria-label="Layout" className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
            {(["grouped", "list"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={preferences.positionsLayout === value}
                onClick={() => updatePreference("positionsLayout", value)}
                title={value === "grouped" ? "A section per venue" : "One list, venue badge on each row"}
                className={`h-6 rounded-md px-2 text-[11px] font-semibold ${
                  preferences.positionsLayout === value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"
                }`}
              >
                {value === "grouped" ? "By venue" : "List"}
              </button>
            ))}
          </div>
        )}
        {account && (
          <span className="ml-auto flex shrink-0 items-center gap-3 pl-2 text-[12px] tabular-nums text-app-muted">
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
                label="Close all"
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
        ) : tab === "orderHistory" ? (
          <OrderHistoryTable />
        ) : tab === "positionHistory" ? (
          <PositionHistoryTable />
        ) : (
          <VenuesTable rows={summaries} positions={positions} />
        )}
      </div>
    </section>
  );
}
