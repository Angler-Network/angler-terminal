"use client";

import { useCallback, useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { formatPrice } from "@/lib/format";
import { BOOK_SPOT_VENUE_NAMES, bookSpotRef, type BookSpotMarket } from "@/lib/spot/book-spot";
import type { SpotOpenOrderRow } from "@/lib/spot/book-spot-account";
import type { SpotAccountData } from "@/lib/venues/book-spot-account";
import { useSelectedAsset } from "./selected-asset";
import { amountText } from "./swap-card";
import { useWallet } from "./wallet-provider";

type Tab = "balances" | "orders" | "history";

const REFRESH_MS = 15_000;
const th = "whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint";
const td = "whitespace-nowrap px-3 py-1.5 tabular-nums text-app-ink";
const time = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The data loads on demand: the venue clients stay off the first screen. */
async function load(user: `0x${string}`, venues: { hyperliquid: boolean; lighter: boolean }) {
  return (await import("@/lib/venues/book-spot-account")).loadSpotAccount(user, venues);
}

function VenueTag({ venue }: { venue: BookSpotMarket["venue"] }) {
  return <span className="rounded bg-app-chip px-1.5 py-0.5 text-[10px] font-semibold text-app-muted">{BOOK_SPOT_VENUE_NAMES[venue]}</span>;
}

/**
 * Under the chart on Spot Dex (order-book markets): the wallet's Hyperliquid and Lighter spot account across every
 * spot market. Balances (USD value at the market price; a row opens its market), open orders with Cancel, and the
 * last orders. Refreshes every 15s while the tab is visible and right after a cancel.
 */
export function SpotBookPanel() {
  const { address } = useWallet();
  const { preferences } = usePreferences();
  const { selectAsset } = useSelectedAsset();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("balances");
  const [data, setData] = useState<SpotAccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);
  const venues = { hyperliquid: preferences.venueHyperliquid, lighter: preferences.venueLighter };

  const refresh = useCallback(async () => {
    if (!address) return setData(null);
    setLoading(true);
    try {
      setData(await load(address, { hyperliquid: preferences.venueHyperliquid, lighter: preferences.venueLighter }));
    } catch {
      // Keep the last good data on a failed refresh.
    } finally {
      setLoading(false);
    }
  }, [address, preferences.venueHyperliquid, preferences.venueLighter]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const open = (market: BookSpotMarket | null) => market && selectAsset(market.asset, bookSpotRef(market.venue, market.id));

  const cancel = async (order: SpotOpenOrderRow) => {
    if (!address) return;
    const key = `${order.venue}:${order.oid}`;
    setCanceling(key);
    try {
      const { cancelSpotOrder } = await import("@/lib/venues/book-spot-account");
      await cancelSpotOrder(address, order.market, order.oid);
      setData((current) => (current ? { ...current, orders: current.orders.filter((entry) => `${entry.venue}:${entry.oid}` !== key) } : current));
      void refresh();
    } catch (cause) {
      toast({ tone: "error", title: "Couldn't cancel the order", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setCanceling(null);
    }
  };

  const balances = data?.balances ?? [];
  const orders = data?.orders ?? [];
  const history = data?.history ?? [];
  const total = balances.reduce((sum, entry) => sum + (entry.usd ?? 0), 0);
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "balances", label: "Balances", count: balances.length || undefined },
    { id: "orders", label: "Open orders", count: orders.length || undefined },
    { id: "history", label: "Order history" },
  ];
  const empty = (text: string) => <p className="px-3 py-3 text-[12px] text-app-faint">{text}</p>;
  const lighterNote = venues.lighter && data && !data.lighterOrdersReadable ? " Lighter orders show once this browser holds your Lighter trading key." : "";

  return (
    <section aria-label="Spot account" className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <div role="tablist" className="scrollbar-none flex shrink-0 items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-app-hairline px-3">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px h-9 border-b-2 text-[12px] font-semibold transition-colors ${tab === id ? "border-app-accent text-app-ink" : "border-transparent text-app-muted hover:text-app-ink"}`}
          >
            {label}
            {count !== undefined && <span className="ml-1 tabular-nums text-app-faint">{count}</span>}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-[12px] text-app-muted">
          {loading && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-app-accent" />}
          {tab === "balances" && balances.length > 0 && (
            <>
              Total <span className="font-semibold tabular-nums text-app-ink">{formatPrice(total)}</span>
            </>
          )}
        </span>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
        {!address ? (
          empty("Connect your EVM wallet to see your Hyperliquid and Lighter spot balances and orders.")
        ) : data === null ? (
          empty("Loading your spot account…")
        ) : tab === "balances" ? (
          balances.length === 0 ? (
            empty("No spot balances on Hyperliquid or Lighter yet.")
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-app-card">
                <tr>
                  <th className={th}>Token</th>
                  <th className={th}>Venue</th>
                  <th className={th}>Total</th>
                  <th className={th}>Available</th>
                  <th className={th}>Value</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((entry) => (
                  <tr
                    key={`${entry.venue}:${entry.token}`}
                    onClick={() => open(entry.market)}
                    className={`border-t border-app-hairline ${entry.market ? "cursor-pointer hover:bg-app-chip/40" : ""}`}
                    title={entry.market ? `Open ${entry.token}/USDC` : undefined}
                  >
                    <td className={`${td} font-semibold`}>{entry.token}</td>
                    <td className={td}>
                      <VenueTag venue={entry.venue} />
                    </td>
                    <td className={td}>{amountText(entry.total)}</td>
                    <td className={`${td} text-app-muted`}>{amountText(entry.available)}</td>
                    <td className={td}>{entry.usd === null ? <span className="text-app-faint">—</span> : formatPrice(entry.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === "orders" ? (
          orders.length === 0 ? (
            empty(`No open spot orders.${lighterNote}`)
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-app-card">
                <tr>
                  <th className={th}>Market</th>
                  <th className={th}>Side</th>
                  <th className={th}>Price</th>
                  <th className={th}>Size</th>
                  <th className={th}>Filled</th>
                  <th className={th}>Placed</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const key = `${order.venue}:${order.oid}`;
                  return (
                    <tr key={key} className="border-t border-app-hairline">
                      <td className={td}>
                        <button type="button" onClick={() => open(order.market)} className="flex items-center gap-1.5 font-semibold hover:underline">
                          {order.market.base}/USDC <VenueTag venue={order.venue} />
                        </button>
                      </td>
                      <td className={`${td} font-semibold ${order.side === "buy" ? "text-app-up" : "text-app-down"}`}>{order.side === "buy" ? "Buy" : "Sell"}</td>
                      <td className={td}>{formatPrice(order.price)}</td>
                      <td className={td}>{amountText(order.size)}</td>
                      <td className={`${td} text-app-muted`}>{amountText(Math.max(0, order.origSize - order.size))}</td>
                      <td className={`${td} text-app-muted`}>{order.time ? time.format(order.time) : "—"}</td>
                      <td className={`${td} text-right`}>
                        <button
                          type="button"
                          disabled={canceling !== null}
                          onClick={() => void cancel(order)}
                          className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-app-muted hover:bg-app-down/10 hover:text-app-down disabled:opacity-50"
                        >
                          {canceling === key ? "Canceling…" : "Cancel"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : history.length === 0 ? (
          empty(`No past spot orders.${lighterNote}`)
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-app-card">
              <tr>
                <th className={th}>Time</th>
                <th className={th}>Market</th>
                <th className={th}>Type</th>
                <th className={th}>Side</th>
                <th className={th}>Price</th>
                <th className={th}>Filled / Size</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-t border-app-hairline">
                  <td className={`${td} text-app-muted`}>{row.time ? time.format(row.time) : "—"}</td>
                  <td className={td}>
                    <span className="flex items-center gap-1.5 font-semibold">
                      {row.symbol} <VenueTag venue={row.spotVenue} />
                    </span>
                  </td>
                  <td className={`${td} text-app-muted`}>{row.type}</td>
                  <td className={`${td} font-semibold ${row.side === "buy" ? "text-app-up" : "text-app-down"}`}>{row.side === "buy" ? "Buy" : "Sell"}</td>
                  <td className={td}>{row.price === null ? <span className="text-app-faint">Market</span> : formatPrice(row.price)}</td>
                  <td className={td}>
                    {amountText(row.filled)} / {amountText(row.size)}
                  </td>
                  <td className={`${td} ${row.outcome === "filled" ? "text-app-up" : row.outcome === "rejected" ? "text-app-down" : "text-app-muted"}`}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
