"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { trackTrade } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { BOOK_SPOT_VENUE_NAMES, HL_SPOT_MIN_ORDER_USD, parseBookSpotRef, type BookSpotMarket, type BookSpotOpenOrder } from "@/lib/spot/book-spot";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { useAssetSearch } from "./asset-search";
import { amountText, DetailRow } from "./swap-card";
import { CoinIcon } from "./token-icon";
import { useOrderDraft } from "./order-draft";
import { useTrading } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

const SHARES = [25, 50, 75, 100];
const PRICE_REFRESH_MS = 5_000;
const ACCOUNT_REFRESH_MS = 15_000;
/** Market orders cross the book up to this far from the reference price (`DEFAULT_SLIPPAGE` of each venue). */
const MAX_SLIPPAGE: Record<BookSpotMarket["venue"], string> = { hyperliquid: "5%", lighter: "3%" };

interface BookSpotAccount {
  exists: boolean;
  /** USDC a buy can spend right now. */
  spendable: number;
  /** USDC sitting on perps that could be moved to spot (0 on a unified Hyperliquid account). */
  movable: number;
  base: number;
}

/** The venue modules load on demand: the Hyperliquid SDK and Lighter's signer stay off the first screen. */
async function placeOrder(user: `0x${string}`, market: BookSpotMarket, order: { side: "buy"; usd: number } | { side: "sell"; base: number }) {
  if (market.venue === "hyperliquid") return (await import("@/lib/venues/hyperliquid/spot")).placeHlSpotOrder(user, market, order);
  return { ...(await (await import("@/lib/venues/lighter/spot")).placeLighterSpotOrder(user, market, order)), partnerFeeBps: 0 };
}

/** Limit orders, open orders and cancels: the same venue modules, loaded on demand. */
async function placeLimit(user: `0x${string}`, market: BookSpotMarket, order: { side: "buy" | "sell"; base: number; price: number }) {
  if (market.venue === "hyperliquid") return (await import("@/lib/venues/hyperliquid/spot")).placeHlSpotLimit(user, market, order);
  const placed = await (await import("@/lib/venues/lighter/spot")).placeLighterSpotLimit(user, market, order);
  return placed.status === "filled" ? { ...placed, partnerFeeBps: 0 } : placed;
}

async function loadOpenOrders(user: `0x${string}`, market: BookSpotMarket): Promise<BookSpotOpenOrder[]> {
  if (market.venue === "hyperliquid") return (await import("@/lib/venues/hyperliquid/spot")).loadHlSpotOpenOrders(user, market);
  return (await import("@/lib/venues/lighter/spot")).loadLighterSpotOpenOrders(user, market);
}

async function cancelOrder(user: `0x${string}`, market: BookSpotMarket, oid: number) {
  if (market.venue === "hyperliquid") return (await import("@/lib/venues/hyperliquid/spot")).cancelHlSpotOrder(user, market, oid);
  return (await import("@/lib/venues/lighter/spot")).cancelLighterSpotOrder(user, market, oid);
}

async function loadMarket(venue: BookSpotMarket["venue"], id: number) {
  return venue === "hyperliquid" ? (await import("@/lib/venues/hyperliquid/spot")).loadHlSpotMarket(id) : (await import("@/lib/venues/lighter/spot")).loadLighterSpotMarket(id);
}

async function loadAccount(user: `0x${string}`, market: BookSpotMarket): Promise<BookSpotAccount> {
  if (market.venue === "hyperliquid") {
    const account = await (await import("@/lib/venues/hyperliquid/spot")).loadHlSpotAccount(user, market);
    return { exists: true, spendable: account.spendable, movable: account.unified ? 0 : account.perpsAvailable, base: account.base };
  }
  const account = await (await import("@/lib/venues/lighter/spot")).loadLighterSpotAccount(user, market);
  return { exists: account.exists, spendable: account.spotUsdc, movable: account.perpsAvailable, base: account.base };
}

/** The market (refreshed for its price) for a `book:<venue>:<id>` ref; null when the venue doesn't list it. */
function useBookSpotMarket(venue: BookSpotMarket["venue"], id: number) {
  const [market, setMarket] = useState<BookSpotMarket | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setMarket(undefined);
    const load = () =>
      loadMarket(venue, id)
        .then((next) => active && setMarket((current) => next ?? (current ? current : null)))
        .catch(() => active && setMarket((current) => current ?? null));
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), PRICE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [venue, id]);
  return market;
}

/**
 * The /spot order form for a Hyperliquid or Lighter spot market (`book:<venue>:<id>`), laid out like an exchange's:
 * Buy/Sell, Market (IOC across the book) or Limit (resting; a price clicked in the order book fills it in), size in
 * the base token with % of what's available, then the market's open orders with Cancel. It trades with the account
 * and key the terminal already uses for perps. Buys spend spot USDC; when it sits on the perps side, one press moves
 * it over first.
 */
export function BookSpotCard({ tokenRef }: { tokenRef: string }) {
  const ref = parseBookSpotRef(tokenRef);
  const market = useBookSpotMarket(ref?.venue ?? "hyperliquid", ref?.id ?? -1);
  if (!ref) return null;
  if (market === undefined) {
    return (
      <div role="status" aria-label="Loading market" className="flex h-[300px] flex-col gap-2.5">
        {["h-6", "h-24", "h-24", "h-11"].map((height, index) => (
          <span key={index} aria-hidden className={`${height} shrink-0 animate-pulse rounded-xl bg-app-chip/60`} />
        ))}
      </div>
    );
  }
  if (market === null) return <p className="text-[12px] text-app-faint">{BOOK_SPOT_VENUE_NAMES[ref.venue]} doesn&apos;t list this market right now. Pick another one from the search.</p>;
  return <BookSpotForm key={tokenRef} market={market} />;
}

function BookSpotForm({ market }: { market: BookSpotMarket }) {
  const { preferences } = usePreferences();
  const { address, getWalletClient } = useWallet();
  const { open: openWallets } = useWalletModal();
  const { open: openSearch } = useAssetSearch();
  const { isVenueReady, openSetup, openDeposit } = useTrading();
  const { pickedPrice } = useOrderDraft();
  const toast = useToast();
  const venueName = BOOK_SPOT_VENUE_NAMES[market.venue];
  const ready = isVenueReady(market.venue);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [limitPx, setLimitPx] = useState("");
  const [size, setSize] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<"order" | "move" | null>(null);
  const [account, setAccount] = useState<BookSpotAccount | null>(null);
  const [orders, setOrders] = useState<BookSpotOpenOrder[]>([]);
  const [canceling, setCanceling] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The market object is replaced every few seconds for its price; balances and orders only follow the pair.
  const marketRef = useRef(market);
  marketRef.current = market;
  const refresh = useCallback(async () => {
    if (!address) {
      setAccount(null);
      setOrders([]);
      return;
    }
    const [nextAccount, nextOrders] = await Promise.all([loadAccount(address, marketRef.current).catch(() => null), loadOpenOrders(address, marketRef.current).catch(() => null)]);
    setAccount(nextAccount);
    if (nextOrders) setOrders(nextOrders);
  }, [address]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void refresh(), ACCOUNT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    setArmed(false);
    setError(null);
  }, [size, side, kind, limitPx]);
  // A price clicked in the order book makes this a limit order at that price.
  useEffect(() => {
    if (!pickedPrice) return;
    setKind("limit");
    setLimitPx(String(pickedPrice.price));
  }, [pickedPrice]);

  const mid = market.price ?? 0;
  const price = kind === "limit" ? Number(limitPx) || 0 : mid;
  const base = Number(size) || 0;
  const total = base * price;
  const minUsd = market.venue === "hyperliquid" ? HL_SPOT_MIN_ORDER_USD : Math.max(market.minQuoteAmount ?? 0, (market.minBaseAmount ?? 0) * price);
  const available = account ? (side === "buy" ? account.spendable : account.base) : null;
  const shortfall = side === "buy" && account ? Math.max(0, total - account.spendable) : 0;
  const canMove = side === "buy" && account !== null && shortfall > 0 && account.movable >= shortfall;
  const problem = !(base > 0)
    ? null
    : !(price > 0)
      ? kind === "limit"
        ? "Enter a limit price."
        : `${venueName} has no price for ${market.base} right now.`
      : total < minUsd
        ? `${venueName}'s minimum is about $${Math.ceil(minUsd)}.`
        : account && available !== null && (side === "buy" ? total : base) > available + 1e-9 && !canMove
          ? `Not enough ${side === "buy" ? "USDC" : market.base} on ${venueName}${side === "buy" ? " spot" : ""}.`
          : null;
  const builderBps = market.venue === "hyperliquid" ? (hlConfig.builder?.fee ?? 0) / 10 : 0;
  const step = 10 ** -market.szDecimals;
  const floorSize = (value: number) => Math.floor(value / step) * step;

  const moveToSpot = async () => {
    if (!address || !account) return;
    setBusy("move");
    try {
      if (market.venue === "hyperliquid") {
        if (!getWalletClient) throw new Error("Connect your EVM wallet.");
        const { moveUsdcToSpot } = await import("@/lib/venues/hyperliquid/outcomes");
        await moveUsdcToSpot(await getWalletClient(), shortfall);
      } else {
        const { moveLighterUsdcToSpot } = await import("@/lib/venues/lighter/spot");
        await moveLighterUsdcToSpot(address, market, shortfall);
      }
      toast({ tone: "success", title: "USDC moved to spot", message: `You can buy ${market.base} on ${venueName} now.` });
      await refresh();
    } catch (cause) {
      toast({ tone: "error", title: "Couldn't move USDC", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!address) return openWallets();
    if (!ready) return openSetup(market.venue);
    if (account && !account.exists) return openDeposit(market.venue, "deposit");
    if (problem || !(base > 0) || !(price > 0)) return;
    if (canMove) return moveToSpot();
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setBusy("order");
    setError(null);
    try {
      const placed =
        kind === "limit"
          ? await placeLimit(address, market, { side, base, price })
          : { status: "filled" as const, ...(await placeOrder(address, market, side === "buy" ? { side: "buy", usd: total } : { side: "sell", base })) };
      if (placed.status === "resting") {
        toast({ tone: "success", title: `${side === "buy" ? "Buy" : "Sell"} order placed`, message: `${amountText(base)} ${market.base} at ${formatPrice(price)} on ${venueName} spot` });
      } else {
        const filledUsd = placed.filledSize * placed.avgPx;
        toast({
          tone: "success",
          title: `${side === "buy" ? "Bought" : "Sold"} ${amountText(placed.filledSize)} ${market.base}`,
          message: `at ${formatPrice(placed.avgPx)} on ${venueName} spot · ${formatPrice(filledUsd)}`,
        });
        trackTrade({ venue: market.venue, side, newsId: null, oneClick: preferences.oneClickTrading, usd: filledUsd, feeBps: placed.partnerFeeBps });
      }
      setSize("");
      void refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setArmed(false);
    }
  };

  const cancel = async (oid: number) => {
    if (!address) return;
    setCanceling(oid);
    try {
      await cancelOrder(address, market, oid);
      setOrders((current) => current.filter((order) => order.oid !== oid));
      void refresh();
    } catch (cause) {
      toast({ tone: "error", title: "Couldn't cancel the order", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setCanceling(null);
    }
  };

  const label = !address
    ? "Connect EVM wallet"
    : !ready
      ? `Set up ${venueName} trading`
      : account && !account.exists
        ? `Deposit to ${venueName}`
        : busy === "move"
          ? market.venue === "hyperliquid"
            ? "Confirm in your wallet…"
            : "Moving USDC…"
          : busy === "order"
            ? "Placing order…"
            : !(base > 0)
              ? "Enter a size"
              : canMove
                ? `Move ${formatPrice(shortfall)} from perps to spot`
                : armed
                  ? `Confirm: ${side === "buy" ? "buy" : "sell"} ${amountText(base)} ${market.base}`
                  : `${kind === "limit" ? "Place " : ""}${side === "buy" ? "Buy" : "Sell"} ${market.base}${kind === "limit" ? " order" : ""}`;
  const field = "flex h-10 items-center gap-2 rounded-lg border border-app-hairline bg-app-chip/30 px-2.5 focus-within:border-app-hairline-strong";
  const input = "min-w-0 flex-1 bg-transparent text-right text-[14px] font-semibold tabular-nums text-app-ink outline-hidden placeholder:text-app-faint";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={openSearch} title="Pick another market" className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13px] font-semibold text-app-ink hover:bg-app-chip">
          <CoinIcon symbol={market.asset} chain={market.venue === "hyperliquid" ? "hyperliquid" : undefined} size={20} />
          {market.base}/USDC
          <ChevronDown className="size-3.5 text-app-muted" aria-hidden />
        </button>
        <span className="text-[11px] text-app-muted">{venueName} spot</span>
      </div>

      <div role="group" aria-label="Side" className="grid grid-cols-2 gap-0.5 rounded-lg bg-app-chip p-0.5">
        {(["buy", "sell"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={side === value}
            onClick={() => setSide(value)}
            className={`h-8 rounded-md text-[13px] font-semibold transition-colors ${
              side === value ? (value === "buy" ? "bg-app-up text-black" : "bg-app-down text-white") : "text-app-muted hover:text-app-ink"
            }`}
          >
            {value === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div role="group" aria-label="Order type" className="flex gap-1">
        {(["market", "limit"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              if (value === "limit" && !limitPx && mid > 0) setLimitPx(String(Number(mid.toPrecision(6))));
            }}
            className={`h-7 rounded-md px-2.5 text-[12px] font-semibold ${kind === value ? "bg-app-chip text-app-ink" : "text-app-muted hover:text-app-ink"}`}
          >
            {value === "market" ? "Market" : "Limit"}
          </button>
        ))}
        {available !== null && (
          <span className="ml-auto self-center text-[11px] text-app-faint">
            Available <span className="font-semibold tabular-nums text-app-ink">{amountText(available)}</span> {side === "buy" ? "USDC" : market.base}
          </span>
        )}
      </div>

      {kind === "limit" && (
        <label className={field}>
          <span className="text-[12px] text-app-muted">Price</span>
          <input aria-label="Limit price" inputMode="decimal" placeholder="0" value={limitPx} disabled={busy !== null} onChange={(event) => setLimitPx(event.target.value.replace(/[^0-9.]/g, ""))} className={input} />
          <button type="button" onClick={() => mid > 0 && setLimitPx(String(Number(mid.toPrecision(6))))} className="text-[11px] font-semibold text-app-accent hover:opacity-80">
            Mid
          </button>
          <span className="text-[12px] text-app-faint">USDC</span>
        </label>
      )}
      <label className={field}>
        <span className="text-[12px] text-app-muted">Size</span>
        <input aria-label={`${market.base} size`} inputMode="decimal" placeholder="0" value={size} disabled={busy !== null} onChange={(event) => setSize(event.target.value.replace(/[^0-9.]/g, ""))} className={input} />
        <span className="text-[12px] text-app-faint">{market.base}</span>
      </label>
      {available !== null && available > 0 && price > 0 && (
        <div className="flex gap-1">
          {SHARES.map((share) => (
            <button
              key={share}
              type="button"
              onClick={() => setSize(String(Number(floorSize(((side === "buy" ? available / price : available) * share) / 100).toFixed(market.szDecimals))))}
              className="h-6 flex-1 rounded-md bg-app-chip text-[11px] font-semibold text-app-muted hover:text-app-ink"
            >
              {share === 100 ? "Max" : `${share}%`}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-xl border border-app-hairline p-2.5">
        <DetailRow label={kind === "market" ? "Est. total" : "Total"}>{total > 0 ? `${formatPrice(total)} USDC` : "—"}</DetailRow>
        {kind === "market" && <DetailRow label="Max slippage">{MAX_SLIPPAGE[market.venue]}</DetailRow>}
        {market.takerFee !== undefined && <DetailRow label={`${venueName} fee`}>{market.takerFee === 0 ? "None" : `${(market.takerFee * 100).toFixed(3)}%`}</DetailRow>}
        {builderBps > 0 && <DetailRow label="Platform fee">{`${builderBps.toFixed(2)} bps`}</DetailRow>}
      </div>
      {canMove && (
        <p className="text-[12px] text-app-muted">
          Your USDC is on {venueName} perps. One press moves {formatPrice(shortfall)} to spot{market.venue === "hyperliquid" ? " (a wallet signature)" : ""}, the next places the order.
        </p>
      )}
      {(problem || error) && <p className="text-[12px] text-app-down">{error ?? problem}</p>}
      <button
        type="button"
        disabled={busy !== null || (Boolean(address) && ready && account?.exists !== false && (!(base > 0) || problem !== null))}
        onClick={() => void submit()}
        className={`h-11 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 ${
          armed ? "bg-app-ink text-app-card" : side === "buy" ? "bg-app-up text-black hover:opacity-90" : "bg-app-down text-white hover:opacity-90"
        }`}
      >
        {label}
      </button>

      {orders.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-xl border border-app-hairline">
          <div className="border-b border-app-hairline bg-app-chip/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.06em] text-app-faint">Open orders · {market.base}</div>
          {orders.map((order) => (
            <div key={order.oid} className="flex h-8 items-center gap-2 border-t border-app-hairline px-2.5 text-[12px] first:border-t-0">
              <span className={`w-8 font-semibold ${order.side === "buy" ? "text-app-up" : "text-app-down"}`}>{order.side === "buy" ? "Buy" : "Sell"}</span>
              <span className="tabular-nums text-app-ink">{amountText(order.size)}</span>
              <span className="text-app-faint">@</span>
              <span className="tabular-nums text-app-ink">{formatPrice(order.price)}</span>
              <button
                type="button"
                disabled={canceling !== null}
                onClick={() => void cancel(order.oid)}
                className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-app-muted hover:bg-app-down/10 hover:text-app-down disabled:opacity-50"
              >
                {canceling === order.oid ? "Canceling…" : "Cancel"}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-app-faint">
        {venueName} spot uses your {venueName} account and trading key, like perps. Bought tokens stay on {venueName}.
        {market.venue === "lighter" ? " Open orders show once this browser holds the trading key." : ""}
      </p>
    </div>
  );
}
