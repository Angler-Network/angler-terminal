"use client";

import { ArrowDown, ChevronDown, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { trackTrade } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { uniswapListingId } from "@/lib/spot/listings";
import { MAX_SPOT_PRICE_IMPACT_PCT } from "@/lib/trading/presets";
import { bpsToPercent } from "@/lib/trading/slippage";
import { fromBaseUnits, toBaseUnits } from "@/lib/venues/jupiter/amounts";
import { sameAddress, type EvmSwapChain, type EvmSwapToken } from "@/lib/venues/uniswap/chains";
import { fetchUniswapQuote } from "@/lib/venues/uniswap/client";
import type { UniswapQuote } from "@/lib/venues/uniswap/quote";
import type { OrderSide } from "@/lib/venues/types";
import { useAssetSearch } from "./asset-search";
import { Picker } from "./inline-picker";
import { DetailRow, SlippageSettings, amountSize, amountText, pillClass } from "./swap-card";
import { recordSwap } from "./swap-history-store";
import { CoinIcon } from "./token-icon";
import { useEvmToken, type EvmToken } from "./use-evm-token";
import { useSpotListings } from "./use-spot-listings";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

const ARM_MS = 5_000;
const QUOTE_DEBOUNCE_MS = 500;
const QUOTE_REFRESH_MS = 15_000;
const BALANCE_REFRESH_MS = 15_000;
const SHARES = [25, 50, 75, 100];
const DOLLARS = new Set(["USDC", "USDT"]);

type Side = Pick<EvmSwapToken, "address" | "symbol" | "decimals"> & { icon?: string };

/** The wallet's balances of `tokens` on the chain, refreshed while the tab is visible. */
function useBalances(chain: EvmSwapChain, owner: `0x${string}` | null, tokens: string[], refresh: number) {
  const key = owner ? `${chain.id}:${owner}:${tokens.join(",")}:${refresh}` : null;
  const [state, setState] = useState<{ key: string; amounts: Record<string, bigint> } | null>(null);
  useEffect(() => {
    if (!key || !owner) return;
    let active = true;
    const load = async () => {
      try {
        const { createPublicClient, erc20Abi, http } = await import("viem");
        const client = createPublicClient({ transport: http(chain.rpc) });
        const amounts = await Promise.all(
          tokens.map((address) => client.readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner] })),
        );
        if (active) setState({ key, amounts: Object.fromEntries(tokens.map((address, index) => [address.toLowerCase(), amounts[index]])) });
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers the chain, wallet, tokens and refreshes
  }, [key]);
  return key && state?.key === key ? state.amounts : null;
}

/** A debounced Uniswap quote for the exact input, refreshed every few seconds. */
function useQuote(input: { chainId: number; tokenIn: string; tokenOut: string; amount: bigint | null; swapper: string | null; slippageBps: number | null }) {
  const key = input.amount && input.amount > 0n ? [input.chainId, input.tokenIn, input.tokenOut, input.amount, input.swapper, input.slippageBps].join("|") : null;
  const [state, setState] = useState<{ key: string; quote?: UniswapQuote; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!key || !input.amount) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const quote = await fetchUniswapQuote({ ...input, amount: input.amount! });
        if (active) setState({ key, quote });
      } catch (error) {
        if (active) setState({ key, error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (active) setLoading(false);
      }
    };
    const debounce = window.setTimeout(load, QUOTE_DEBOUNCE_MS);
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), QUOTE_REFRESH_MS);
    return () => {
      active = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers every input
  }, [key]);
  return { ...(key && state?.key === key ? state : {}), loading };
}

/** Exact base units for typed text; a "Max" that float rounding pushes past the balance snaps back to it. */
function inputUnits(text: string, decimals: number, balance: bigint | undefined) {
  if (!(Number(text) > 0)) return null;
  let units: bigint;
  try {
    units = toBaseUnits(text, decimals);
  } catch {
    return null;
  }
  if (balance !== undefined && units > balance && units - balance <= balance / 1_000_000n) return balance;
  return units;
}

async function viemChain(chain: EvmSwapChain) {
  const { arbitrum, base, mainnet } = await import("viem/chains");
  const known = [mainnet, base, arbitrum].find((entry) => entry.id === chain.id)!;
  return { ...known, rpcUrls: { default: { http: [chain.rpc] } } };
}

/**
 * Swap card for a Uniswap token on an EVM chain (picked in the market search: "Uniswap · Base"): sell / buy boxes
 * like the Solana card, paid with the chain's USDC, WETH or USDT, quoted by the Uniswap Trading API as an exact input
 * and executed through `uniswapSwap` (Permit2, then a router transaction or a gasless UniswapX order).
 */
export function EvmSwapCard({ tokenRef }: { tokenRef: string }) {
  const token = useEvmToken(tokenRef);
  if (token === undefined) {
    return (
      <div role="status" aria-label="Loading token" className="flex h-[360px] flex-col gap-2.5">
        {["h-7", "h-28", "h-28", "h-11"].map((height, index) => (
          <span key={index} aria-hidden className={`${height} shrink-0 animate-pulse rounded-xl bg-app-chip/60`} />
        ))}
      </div>
    );
  }
  if (token === null) return <p className="text-[12px] text-app-faint">This token can&apos;t be read on its chain. Pick another one from the search.</p>;
  return <EvmSwapForm key={`${token.chain.id}:${token.address}`} token={token} />;
}

function EvmSwapForm({ token }: { token: EvmToken }) {
  const { preferences } = usePreferences();
  const { address: owner, wallet } = useWallet();
  const { open: openWallets } = useWalletModal();
  const { open: openSearch } = useAssetSearch();
  const toast = useToast();
  const listings = useSpotListings();
  const chain = token.chain;
  const payOptions = chain.pay.filter((entry) => !sameAddress(entry.address, token.address));
  const [payAddress, setPayAddress] = useState(payOptions[0]?.address ?? chain.pay[0].address);
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [armed, setArmed] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const slippageBps = preferences.swapSlippageBps;

  const payToken = payOptions.find((entry) => entry.address === payAddress) ?? payOptions[0];
  const listingOf = (address: string) => listings?.find((listing) => listing.id === uniswapListingId(chain.id, address));
  const payPrice = DOLLARS.has(payToken.symbol) ? 1 : listingOf(payToken.address)?.price;
  const pay: Side = { ...payToken, icon: listingOf(payToken.address)?.icon };
  const asset: Side = { address: token.address, symbol: token.symbol, decimals: token.decimals, icon: token.icon };
  const sell = side === "buy" ? pay : asset;
  const buy = side === "buy" ? asset : pay;
  const sellPrice = side === "buy" ? payPrice : token.price;
  const buyPrice = side === "buy" ? token.price : payPrice;

  const balances = useBalances(chain, owner, [pay.address, asset.address], refresh);
  const sellBalance = balances ? balances[sell.address.toLowerCase()] : undefined;
  const units = inputUnits(amount, sell.decimals, sellBalance);
  const { quote, error: quoteError, loading } = useQuote({
    chainId: chain.id,
    tokenIn: sell.address,
    tokenOut: buy.address,
    amount: units,
    swapper: owner,
    slippageBps,
  });
  const value = Number(amount) || 0;
  const receive = quote ? fromBaseUnits(quote.outAmount, buy.decimals) : sellPrice && buyPrice && value > 0 ? (value * sellPrice) / buyPrice : null;
  const sellUsd = sellPrice ? value * sellPrice : null;
  const receiveUsd = receive !== null && buyPrice ? receive * buyPrice : null;
  const minOut = quote?.minOutAmount ? fromBaseUnits(quote.minOutAmount, buy.decimals) : null;
  const shownBalance = (address: string, decimals: number) => (balances ? fromBaseUnits(balances[address.toLowerCase()] ?? 0n, decimals) : null);
  const sellBalanceShown = shownBalance(sell.address, sell.decimals);
  const error =
    value <= 0
      ? null
      : units === null
        ? "Enter a valid amount."
        : sellBalance !== undefined && units > sellBalance
          ? `Not enough ${sell.symbol} on ${chain.name}.`
          : quoteError ?? null;
  const canSwap = Boolean(owner) && Boolean(quote) && !error && !placing && !loading;

  useEffect(() => setArmed(false), [side, amount, payAddress]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const flip = () => {
    setSide((current) => (current === "buy" ? "sell" : "buy"));
    setAmount(receive && receive > 0 ? String(Number(receive.toPrecision(6))) : "");
  };

  const submit = async () => {
    if (!owner || !wallet) return openWallets();
    if (!canSwap || units === null) return;
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setArmed(false);
    setPlacing(true);
    try {
      const [{ uniswapSwap }, viem] = await Promise.all([import("@/lib/venues/uniswap/venue"), viemChain(chain)]);
      const result = await uniswapSwap({
        provider: wallet.provider,
        account: owner,
        chain: viem,
        tokenIn: sell,
        tokenOut: buy,
        amount: units,
        slippageBps,
        maxPriceImpactPct: MAX_SPOT_PRICE_IMPACT_PCT,
      });
      const sold = fromBaseUnits(result.inAmount, sell.decimals);
      const bought = fromBaseUnits(result.outAmount, buy.decimals);
      toast({
        tone: "success",
        title: `${side === "buy" ? "Bought" : "Sold"} ${amountText(side === "buy" ? bought : sold)} ${token.symbol}`,
        message: `${side === "buy" ? "Spent" : "Received"} ${amountText(side === "buy" ? sold : bought)} ${pay.symbol} on Uniswap · ${chain.name}${result.gasless ? " (gasless)" : ""}`,
        link: { href: result.explorerUrl, label: "View transaction" },
      });
      const usd = (side === "buy" ? sold : bought) * (payPrice ?? 0);
      recordSwap(owner, { tx: result.txHash, at: Date.now(), chain: chain.key, token: token.address, symbol: token.symbol, side, amount: side === "buy" ? bought : sold, usd });
      trackTrade({ venue: "uniswap", side, usd: Math.round(usd * 100) / 100, feeBps: null, newsId: null, oneClick: preferences.oneClickTrading });
      setAmount("");
    } catch (caught) {
      toast({
        tone: "error",
        title: "Uniswap swap failed",
        message: caught instanceof Error ? caught.message : String(caught),
        link: caught instanceof Error && "explorerUrl" in caught && typeof caught.explorerUrl === "string" && caught.explorerUrl ? { href: caught.explorerUrl, label: "View transaction" } : undefined,
      });
    } finally {
      setPlacing(false);
      setRefresh((count) => count + 1);
    }
  };

  const face = (entry: Side) => (
    <>
      <CoinIcon src={entry.icon} symbol={entry.symbol} chain={chain.id} size={24} />
      <span className="flex flex-col items-start leading-tight">
        {entry.symbol}
        <span className="text-[10px] font-medium text-app-muted">{chain.name}</span>
      </span>
    </>
  );
  const assetPill = (
    <button type="button" aria-label="Token" title="Pick another token" onClick={openSearch} className={`${pillClass} hover:bg-app-selected`}>
      {face(asset)}
      <ChevronDown className="size-4 text-app-muted" aria-hidden />
    </button>
  );
  const payPill = (
    <Picker
      label={side === "buy" ? "Pay with" : "Receive"}
      value={payToken.address}
      options={payOptions.map((entry) => ({
        value: entry.address,
        label: `${entry.symbol} · ${chain.name}`,
        icon: <CoinIcon src={listingOf(entry.address)?.icon} symbol={entry.symbol} chain={chain.id} size={20} />,
      }))}
      onChange={(next) => {
        setPayAddress(next);
        setAmount("");
      }}
      buttonClassName={`${pillClass} hover:bg-app-selected`}
    >
      {face(pay)}
    </Picker>
  );
  const box = "flex flex-col gap-2 rounded-2xl border border-app-hairline bg-app-chip/30 p-3";
  const rate = receive && value > 0 ? (side === "buy" ? value / receive : receive / value) : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-app-ink">Swap</span>
        <button
          type="button"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((open) => !open)}
          className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold ${showSettings ? "bg-app-chip text-app-ink" : "text-app-muted hover:text-app-ink"}`}
        >
          {slippageBps === null ? "Auto" : bpsToPercent(slippageBps)}
          <Settings2 className="size-4" aria-hidden />
        </button>
      </div>
      {showSettings && <SlippageSettings />}
      <div className="relative flex flex-col gap-1">
        <div className={box}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-app-muted">Sell</span>
            {sellBalanceShown !== null && (
              <span className="text-app-faint">
                Balance <span className="font-semibold tabular-nums text-app-ink">{amountText(sellBalanceShown)}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label={`${sell.symbol} to sell`}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className={`min-w-0 flex-1 bg-transparent ${amountSize(amount)} font-semibold tabular-nums text-app-ink outline-hidden placeholder:text-app-faint`}
            />
            {side === "buy" ? payPill : assetPill}
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="mr-auto tabular-nums text-app-faint">{sellUsd ? `≈ ${formatPrice(sellUsd)}` : "$0.00"}</span>
            {sellBalance !== undefined &&
              SHARES.map((share) => (
                <button
                  key={share}
                  type="button"
                  onClick={() => setAmount(String(fromBaseUnits((sellBalance * BigInt(share)) / 100n, sell.decimals)))}
                  className="h-6 rounded-full bg-app-chip px-2 text-[11px] font-semibold text-app-muted hover:text-app-ink"
                >
                  {share === 100 ? "Max" : `${share}%`}
                </button>
              ))}
          </div>
        </div>
        <button
          type="button"
          onClick={flip}
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
            {side === "buy" ? assetPill : payPill}
          </div>
          <span className="text-[12px] tabular-nums text-app-faint">{receiveUsd ? `≈ ${formatPrice(receiveUsd)}` : "$0.00"}</span>
        </div>
      </div>

      {rate && (
        <p className="text-[12px] tabular-nums text-app-muted">
          1 {token.symbol} ≈ {DOLLARS.has(pay.symbol) ? formatPrice(rate) : amountText(rate)} {pay.symbol}
          <span className="text-app-faint">
            {" · "}Uniswap on {chain.name}
            {quote ? (quote.settle === "order" ? ", gasless (UniswapX)" : quote.route.length ? ` via ${quote.route.join(", ")}` : "") : ""}
            {loading && <span aria-hidden className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-app-accent align-middle" />}
          </span>
        </p>
      )}
      {!token.verified && (
        <p className="rounded-xl border border-app-down/40 bg-app-down/10 p-2.5 text-[12px] text-app-ink">
          <span className="font-semibold text-app-down">Unverified token.</span> Anyone can create a token with any name and logo. Check the address first:{" "}
          <a href={`${chain.explorer}/token/${token.address}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] underline">
            {token.address.slice(0, 6)}…{token.address.slice(-4)}
          </a>
        </p>
      )}
      {value > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-app-hairline p-2.5">
          <DetailRow label="You sell">
            {amountText(value)} {sell.symbol}
          </DetailRow>
          <DetailRow label="Est. amount">{receive ? `${amountText(receive)} ${buy.symbol}` : "—"}</DetailRow>
          <DetailRow label="Est. out value">{receiveUsd ? `~${formatPrice(receiveUsd)}` : "—"}</DetailRow>
          {minOut !== null && (
            <DetailRow label="Min. received">
              {amountText(minOut)} {buy.symbol}
            </DetailRow>
          )}
          {quote?.priceImpactPct != null && (
            <DetailRow label="Price impact" tone={quote.priceImpactPct > 1 ? "warn" : undefined}>
              {quote.priceImpactPct < 0.01 ? "< 0.01%" : `${quote.priceImpactPct.toFixed(2)}%`}
            </DetailRow>
          )}
          <DetailRow label="Max slippage" tone={slippageBps === null ? "muted" : undefined}>
            {slippageBps === null ? "Auto" : bpsToPercent(slippageBps)}
          </DetailRow>
          {quote && quote.feeBps > 0 && <DetailRow label="Platform fee">{bpsToPercent(quote.feeBps)}</DetailRow>}
          {quote && quote.gasFeeUsd !== null && (
            <DetailRow label="Network fee" tone={quote.gasFeeUsd === 0 ? "muted" : undefined}>
              {quote.gasFeeUsd === 0 ? "None (gasless)" : quote.gasFeeUsd < 0.01 ? "< $0.01" : `~$${quote.gasFeeUsd.toFixed(2)}`}
            </DetailRow>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-app-down">{error}</p>}
      <button
        type="button"
        disabled={Boolean(owner) && !canSwap}
        onClick={() => void submit()}
        className={`h-11 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 ${armed ? "bg-app-ink text-app-card" : "bg-app-accent text-app-on-accent hover:opacity-90"}`}
      >
        {!owner
          ? "Connect EVM wallet"
          : placing
            ? "Confirm in your wallet…"
            : armed
              ? `Confirm: ${amountText(value)} ${sell.symbol} → ${buy.symbol}`
              : value > 0
                ? loading && !quote
                  ? "Getting a quote…"
                  : `Swap ${amountText(value)} ${sell.symbol} → ${buy.symbol}`
                : "Enter an amount"}
      </button>
    </div>
  );
}
