"use client";

import { useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { formatPrice } from "@/lib/format";
import type { VenueOpenOrder, VenuePosition } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useWallet } from "./wallet-provider";

type Tab = "positions" | "orders";

const th = "px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint";
const td = "px-3 py-1.5 tabular-nums text-app-ink";

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

function SymbolCell({ symbol, coin }: { symbol: string; coin: string }) {
  const { selectAsset } = useSelectedAsset();
  return (
    <button type="button" onClick={() => selectAsset(symbol)} className="inline-flex items-center gap-2 font-semibold hover:underline" title={coin}>
      <MarketIcon symbol={symbol} size={18} />
      {symbol}
    </button>
  );
}

function PositionsTable({ positions }: { positions: VenuePosition[] }) {
  const { closePosition } = useTrading();
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 bg-app-card">
        <tr>
          <th className={th}>Asset</th>
          <th className={th}>Size</th>
          <th className={th}>Value</th>
          <th className={th}>Entry</th>
          <th className={th}>Liq.</th>
          <th className={th}>PnL (ROE)</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => {
          const isLong = position.size > 0;
          return (
            <tr key={position.coin} className="border-t border-app-hairline">
              <td className={td}>
                <SymbolCell symbol={position.symbol} coin={position.coin} />
                <span className="ml-1.5 text-app-faint">
                  {position.leverage}x {position.leverageType}
                </span>
              </td>
              <td className={`${td} ${isLong ? "text-app-up" : "text-app-down"}`}>
                {isLong ? "Long " : "Short "}
                {Math.abs(position.size)}
              </td>
              <td className={td}>{formatPrice(position.positionValue)}</td>
              <td className={td}>{formatPrice(position.entryPx)}</td>
              <td className={td}>{position.liquidationPx ? formatPrice(position.liquidationPx) : "—"}</td>
              <td className={`${td} ${position.unrealizedPnl >= 0 ? "text-app-up" : "text-app-down"}`}>
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
          <tr key={order.oid} className="border-t border-app-hairline">
            <td className={td}>
              <SymbolCell symbol={order.symbol} coin={order.coin} />
            </td>
            <td className={td}>
              {order.orderType}
              {order.reduceOnly ? " · Reduce" : ""}
            </td>
            <td className={`${td} ${order.side === "buy" ? "text-app-up" : "text-app-down"}`}>{order.side === "buy" ? "Buy" : "Sell"}</td>
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

/** Live positions and open orders from the venue's WebSocket feed. */
export function PositionsBar() {
  const [tab, setTab] = useState<Tab>("positions");
  const { address } = useWallet();
  const { account } = useTrading();
  const positions = account?.positions ?? [];
  const orders = account?.orders ?? [];
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "positions", label: "Positions", count: positions.length },
    { id: "orders", label: "Open orders", count: orders.length },
  ];
  const rows = tab === "positions" ? positions.length : orders.length;

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
        {account && (
          <span className="ml-auto text-[12px] tabular-nums text-app-muted">
            Withdrawable <span className="text-app-ink">{formatPrice(account.withdrawable)}</span>
          </span>
        )}
      </div>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
        {!address ? (
          <p className="flex h-full items-center justify-center text-[12px] text-app-muted">Connect a wallet to see your {tab === "positions" ? "positions" : "open orders"}.</p>
        ) : !account ? (
          <p className="flex h-full items-center justify-center text-[12px] text-app-muted">Connecting to live account data…</p>
        ) : rows === 0 ? (
          <p className="flex h-full items-center justify-center text-[12px] text-app-muted">No {tab === "positions" ? "open positions" : "open orders"}.</p>
        ) : tab === "positions" ? (
          <PositionsTable positions={positions} />
        ) : (
          <OrdersTable orders={orders} />
        )}
      </div>
    </section>
  );
}
