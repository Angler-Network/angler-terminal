"use client";

import { ArrowDown, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { trackTrade } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { BOOK_SPOT_VENUE_NAMES, HL_SPOT_MIN_ORDER_USD, parseBookSpotRef, pickBookSpotListing, type BookSpotMarket } from "@/lib/spot/book-spot";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { useAssetSearch } from "./asset-search";
import { amountSize, amountText, DetailRow, pillClass } from "./swap-card";
import { CoinIcon, stableLogo } from "./token-icon";
import { useTrading } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useSpotListings } from "./use-spot-listings";
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

/** The Hyperliquid or Lighter spot market (`book:` ref) an asset trades on when nothing else lists it; null otherwise. */
export function useBookSpotFallback(asset: string, enabled: boolean) {
  const { preferences } = usePreferences();
  const listings = useSpotListings(enabled);
  if (!enabled || !listings) return null;
  return pickBookSpotListing(listings, asset, { hyperliquid: preferences.venueHyperliquid, lighter: preferences.venueLighter })?.address ?? null;
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
 * Hyperliquid or Lighter spot (a market picked in the search, `book:<venue>:<id>`): the same Sell/Buy boxes as the
 * other swap cards, filled as an IOC market order on the venue's book with the account the terminal already trades
 * perps with. Buys spend spot USDC; when it sits on the perps side, one press moves it over first.
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
  const toast = useToast();
  const venueName = BOOK_SPOT_VENUE_NAMES[market.venue];
  const ready = isVenueReady(market.venue);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<"order" | "move" | null>(null);
  const [account, setAccount] = useState<BookSpotAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The market object is replaced every few seconds for its price; balances only follow the pair.
  const marketRef = useRef(market);
  marketRef.current = market;
  const refresh = useCallback(async () => {
    if (!address) return setAccount(null);
    try {
      setAccount(await loadAccount(address, marketRef.current));
    } catch {
      setAccount(null);
    }
  }, [address]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void refresh(), ACCOUNT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    setArmed(false);
    setError(null);
  }, [amount, side]);

  const price = market.price ?? 0;
  const value = Number(amount) || 0;
  const usdValue = side === "buy" ? value : value * price;
  const receive = price > 0 && value > 0 ? (side === "buy" ? value / price : value * price) : 0;
  const sellBalance = account ? (side === "buy" ? account.spendable : account.base) : null;
  const minUsd = market.venue === "hyperliquid" ? HL_SPOT_MIN_ORDER_USD : Math.max(market.minQuoteAmount ?? 0, (market.minBaseAmount ?? 0) * price);
  const shortfall = side === "buy" && account ? Math.max(0, value - account.spendable) : 0;
  const canMove = side === "buy" && account !== null && shortfall > 0 && account.movable >= shortfall;
  const problem = !(value > 0)
    ? null
    : !(price > 0)
      ? `${venueName} has no price for ${market.base} right now.`
      : usdValue < minUsd
        ? `${venueName}'s minimum is about $${Math.ceil(minUsd)}.`
        : account && sellBalance !== null && value > sellBalance && !canMove
          ? `Not enough ${side === "buy" ? "USDC" : market.base} on ${venueName}${side === "buy" ? " spot" : ""}.`
          : null;
  const builderBps = market.venue === "hyperliquid" ? (hlConfig.builder?.fee ?? 0) / 10 : 0;

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
    if (problem || !(value > 0)) return;
    if (canMove) return moveToSpot();
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setBusy("order");
    setError(null);
    try {
      const fill = await placeOrder(address, market, side === "buy" ? { side: "buy", usd: value } : { side: "sell", base: value });
      const filledUsd = fill.filledSize * fill.avgPx;
      toast({
        tone: "success",
        title: `${side === "buy" ? "Bought" : "Sold"} ${amountText(fill.filledSize)} ${market.base}`,
        message: `at ${formatPrice(fill.avgPx)} on ${venueName} spot · ${formatPrice(filledUsd)}`,
      });
      trackTrade({ venue: market.venue, side, newsId: null, oneClick: preferences.oneClickTrading, usd: filledUsd, feeBps: fill.partnerFeeBps });
      setAmount("");
      void refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setArmed(false);
    }
  };

  const assetFace = (
    <>
      <CoinIcon symbol={market.asset} chain={market.venue === "hyperliquid" ? "hyperliquid" : undefined} size={24} />
      {market.base}
    </>
  );
  const assetPill = (
    <button type="button" aria-label="Token" title="Pick another market" onClick={openSearch} className={`${pillClass} hover:bg-app-selected`}>
      {assetFace}
      <ChevronDown className="size-4 text-app-muted" aria-hidden />
    </button>
  );
  const usdcPill = (
    <span className={pillClass} title={`USDC on ${venueName}`}>
      <CoinIcon src={stableLogo("USDC")} symbol="USDC" chain={market.venue === "hyperliquid" ? "hyperliquid" : undefined} size={24} />
      USDC
    </span>
  );
  const sellSymbol = side === "buy" ? "USDC" : market.base;
  const buySymbol = side === "buy" ? market.base : "USDC";
  const box = "flex flex-col gap-2 rounded-2xl border border-app-hairline bg-app-chip/30 p-3";

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
            : !(value > 0)
              ? "Enter an amount"
              : canMove
                ? `Move ${formatPrice(shortfall)} from perps to spot`
                : armed
                  ? `Confirm: ${amountText(value)} ${sellSymbol} → ${buySymbol}`
                  : `${side === "buy" ? "Buy" : "Sell"} ${market.base} on ${venueName}`;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-app-ink">Swap</span>
        <span className="text-[12px] text-app-muted">{venueName} spot · order book</span>
      </div>
      <div className="relative flex flex-col gap-1">
        <div className={box}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-app-muted">Sell</span>
            {sellBalance !== null && (
              <span className="text-app-faint">
                {side === "buy" ? "Spot USDC" : "Balance"} <span className="font-semibold tabular-nums text-app-ink">{amountText(sellBalance)}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label={`${sellSymbol} to sell`}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              disabled={busy !== null}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className={`min-w-0 flex-1 bg-transparent ${amountSize(amount)} font-semibold tabular-nums text-app-ink outline-hidden placeholder:text-app-faint`}
            />
            {side === "buy" ? usdcPill : assetPill}
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="mr-auto tabular-nums text-app-faint">{usdValue > 0 ? `≈ ${formatPrice(usdValue)}` : "$0.00"}</span>
            {sellBalance !== null &&
              sellBalance > 0 &&
              SHARES.map((share) => (
                <button
                  key={share}
                  type="button"
                  onClick={() => setAmount(String(Math.floor(sellBalance * share * (side === "buy" ? 100 : 10 ** market.szDecimals) / 100) / (side === "buy" ? 100 : 10 ** market.szDecimals)))}
                  className="h-6 rounded-full bg-app-chip px-2 text-[11px] font-semibold text-app-muted hover:text-app-ink"
                >
                  {share === 100 ? "Max" : `${share}%`}
                </button>
              ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setSide((current) => (current === "buy" ? "sell" : "buy"));
            setAmount("");
          }}
          disabled={busy !== null}
          aria-label="Flip direction"
          title="Flip direction"
          className="absolute left-1/2 top-1/2 z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg border border-app-hairline-strong bg-app-card text-app-muted hover:text-app-ink"
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
        <div className={box}>
          <span className="text-[12px] text-app-muted">Buy</span>
          <div className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate ${amountSize(receive ? amountText(receive) : "0")} font-semibold tabular-nums ${receive ? "text-app-ink" : "text-app-faint"}`}>
              {receive ? amountText(receive) : "0"}
            </span>
            {side === "buy" ? assetPill : usdcPill}
          </div>
          <span className="text-[12px] tabular-nums text-app-faint">{receive ? `≈ ${formatPrice(side === "buy" ? receive * price : receive)}` : "$0.00"}</span>
        </div>
      </div>

      {price > 0 && (
        <p className="text-[12px] tabular-nums text-app-muted">
          1 {market.base} ≈ {formatPrice(price)} <span className="text-app-faint">· {venueName} order book</span>
        </p>
      )}
      {value > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-app-hairline p-2.5">
          <DetailRow label="You sell">
            {amountText(value)} {sellSymbol}
          </DetailRow>
          <DetailRow label="Est. amount">{receive ? `${amountText(receive)} ${buySymbol}` : "—"}</DetailRow>
          <DetailRow label="Max slippage">{MAX_SLIPPAGE[market.venue]}</DetailRow>
          {market.takerFee !== undefined && <DetailRow label={`${venueName} fee`}>{market.takerFee === 0 ? "None" : `${(market.takerFee * 100).toFixed(3)}%`}</DetailRow>}
          {builderBps > 0 && <DetailRow label="Platform fee">{`${builderBps.toFixed(2)} bps`}</DetailRow>}
          <DetailRow label="Network fee" tone="muted">
            None
          </DetailRow>
        </div>
      )}
      {canMove && (
        <p className="text-[12px] text-app-muted">
          Your USDC is on {venueName} perps. One press moves {formatPrice(shortfall)} to spot{market.venue === "hyperliquid" ? " (a wallet signature)" : ""}, the next buys.
        </p>
      )}
      {(problem || error) && <p className="text-[12px] text-app-down">{error ?? problem}</p>}
      <button
        type="button"
        disabled={busy !== null || (Boolean(address) && ready && account?.exists !== false && (!(value > 0) || problem !== null))}
        onClick={() => void submit()}
        className={`h-11 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 ${armed ? "bg-app-ink text-app-card" : "bg-app-accent text-app-on-accent hover:opacity-90"}`}
      >
        {label}
      </button>
      <p className="text-[11px] leading-relaxed text-app-faint">
        {venueName} spot uses your {venueName} account and trading key, like perps. Bought tokens stay on {venueName}.
      </p>
    </div>
  );
}
