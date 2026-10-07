"use client";

import { ArrowDown, ChevronDown, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { trackTrade } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { uniswapListingId } from "@/lib/spot/listings";
import { TERMINAL_PATHS } from "@/lib/terminal-kind";
import { summarizeAcrossQuote } from "@/lib/venues/across";
import { WALLET_CHAINS, WALLET_CHAIN_NAMES, fundsRoute, stepsError, walletChainSource, type FundsStep, type WalletChain } from "@/lib/venues/bridge-routes";
import { HL_WITHDRAW_FEE_USDC, usdcUnits } from "@/lib/venues/deposits";
import { MAX_SPOT_PRICE_IMPACT_PCT } from "@/lib/trading/presets";
import { bpsToPercent } from "@/lib/trading/slippage";
import { fromBaseUnits, toBaseUnits } from "@/lib/venues/jupiter/amounts";
import { evmRef, isNativeToken, sameAddress, wrappedNative, type EvmSwapChain, type EvmSwapToken } from "@/lib/venues/uniswap/chains";
import { fetchUniswapQuote } from "@/lib/venues/uniswap/client";
import type { UniswapQuote } from "@/lib/venues/uniswap/quote";
import type { OrderSide } from "@/lib/venues/types";
import { useAssetSearch } from "./asset-search";
import { bridgeFromFor } from "./bridge-shortcut";
import { Picker, type PickerOption } from "./inline-picker";
import { DetailRow, SlippageSettings, amountSize, amountText, pillClass, useUsdcBalance } from "./swap-card";
import { recordSwap } from "./swap-history-store";
import { CoinIcon, stableLogo } from "./token-icon";
import { useTrading } from "./trading-provider";
import { continueLabel, errorMessage, stepLabel, units6, useFundsRun } from "./use-funds-run";
import { useEvmToken, type EvmToken } from "./use-evm-token";
import { useSpotListings } from "./use-spot-listings";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

const ARM_MS = 5_000;
const QUOTE_DEBOUNCE_MS = 500;
const QUOTE_REFRESH_MS = 15_000;
const BALANCE_REFRESH_MS = 15_000;
const SHARES = [25, 50, 75, 100];
const DOLLARS = new Set(["USDC", "USDT", "USDG"]);
/** ETH a "Max" keeps back for gas: mainnet gas costs more than an L2's. */
const GAS_RESERVE_WEI: Record<number, bigint> = { 1: 5_000_000_000_000_000n, 8453: 300_000_000_000_000n, 42161: 300_000_000_000_000n };

type Side = Pick<EvmSwapToken, "address" | "symbol" | "decimals"> & { icon?: string };

/** The other side of the swap: a token on the token's own chain, or a dollar elsewhere that Across bridges. */
type Counter = { kind: "local"; address: string } | { kind: "remote"; from: WalletChain | "hyperliquid" };

const counterValue = (counter: Counter) => (counter.kind === "local" ? `local:${counter.address}` : `remote:${counter.from}`);
function readCounter(value: string): Counter {
  const [kind, rest] = value.split(":");
  return kind === "remote" ? { kind: "remote", from: rest as WalletChain | "hyperliquid" } : { kind: "local", address: rest };
}

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
          tokens.map((address) =>
            isNativeToken(address)
              ? client.getBalance({ address: owner })
              : client.readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
          ),
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

/** A debounced Across preview of a bridge leg: what lands on the other chain for `units`, and the fee. */
function useAcrossPreview(step: Extract<FundsStep, { kind: "across" }> | null, units: bigint | null, owner: `0x${string}` | null) {
  const key = step && units && units > 0n && owner ? `${step.from.chainId}>${step.to.chainId}:${units}:${owner}` : null;
  const [state, setState] = useState<{ key: string; out?: bigint; feeUsd?: number; error?: string } | null>(null);
  useEffect(() => {
    if (!key || !step || !units || !owner) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const { fetchAcrossQuote } = await import("@/lib/venues/across-client");
        const summary = summarizeAcrossQuote(await fetchAcrossQuote({ from: step.from, to: step.to, units, depositor: owner, recipient: owner }));
        if (active) setState({ key, out: summary.expectedOut, feeUsd: summary.feeUsd });
      } catch (caught) {
        if (active) setState({ key, error: errorMessage(caught) });
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers every input
  }, [key]);
  return key && state?.key === key ? state : null;
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
 * Swap card for a Uniswap token on an EVM chain (picked in the market search: "Uniswap · Base"). The other side is a
 * token on the same chain (USDC, ETH, WETH, USDT) or a dollar on another chain, which makes it a cross-chain swap:
 * buying bridges the USDC/USDG (or a Hyperliquid withdrawal) to the token's chain with Across first, then swaps it on
 * Uniswap; selling swaps to USDC first, then bridges it out. Dollar to dollar (USDC on Base → USDC on Arbitrum) is
 * just the bridge, which is what the sidebar's Bridge opens.
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
  const { network: hlNetwork, accounts } = useTrading();
  const toast = useToast();
  const router = useRouter();
  const listings = useSpotListings();
  const chain = token.chain;
  const chainUsdc = chain.pay[0];
  const tokenIsUsdc = sameAddress(token.address, chainUsdc.address);
  const localOptions = chain.pay.filter((entry) => !sameAddress(entry.address, token.address));
  const remoteChains = WALLET_CHAINS.filter((entry) => entry !== chain.key);
  // A dollar token (the Bridge shortcut opens USDC) starts on another chain's dollar: the bridge.
  const [counter, setCounter] = useState<Counter>(() => {
    const bridgeFrom = bridgeFromFor(evmRef(chain.id, token.address));
    if (bridgeFrom && bridgeFrom !== chain.key) return { kind: "remote", from: bridgeFrom };
    return DOLLARS.has(token.symbol) ? { kind: "remote", from: remoteChains[0] } : { kind: "local", address: localOptions[0].address };
  });
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [armed, setArmed] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  // USDC a cross-chain buy delivered to this chain, waiting for the swap press.
  const [bridged, setBridged] = useState<bigint | null>(null);
  const slippageBps = preferences.swapSlippageBps;

  /** What follows the bridge: the swap press (cross-chain buys) or nothing but a toast naming the received token. */
  const pendingFinish = useRef<"swap" | string | null>(null);

  const { run, setRun, execute } = useFundsRun({
    resume: () => router.push(TERMINAL_PATHS.spot),
    waitForWithdrawal: true,
    onDone: (carry, explorerUrl) => {
      const finish = pendingFinish.current;
      pendingFinish.current = null;
      setRefresh((count) => count + 1);
      if (finish === "swap") {
        setBridged(carry);
        toast({
          tone: "info",
          title: `${units6(carry).toFixed(2)} USDC arrived on ${chain.name}`,
          message: `Press Swap to buy ${token.symbol}.`,
          action: { label: "Open", onClick: () => router.push(TERMINAL_PATHS.spot) },
          durationMs: 15_000,
        });
        return;
      }
      setRun(null);
      setAmount("");
      toast({
        tone: "success",
        title: "Bridged",
        message: `${units6(carry).toFixed(2)} ${finish ?? "USDC"} arrived in your wallet.`,
        ...(explorerUrl && { link: { href: explorerUrl, label: "View transaction" } }),
      });
    },
  });

  const listingOf = (address: string) =>
    listings?.find((listing) => listing.id === uniswapListingId(chain.id, address)) ??
    (isNativeToken(address) ? listings?.find((listing) => listing.id === uniswapListingId(chain.id, wrappedNative(chain).address)) : undefined);
  const remote = counter.kind === "remote" ? counter.from : null;
  // Selling into another chain can't land in a venue account (that's Deposit).
  const effectiveRemote = remote === "hyperliquid" && side === "sell" ? null : remote;
  const localToken = (counter.kind === "local" ? localOptions.find((entry) => sameAddress(entry.address, counter.address)) : null) ?? localOptions[0];
  const remoteSource = effectiveRemote && effectiveRemote !== "hyperliquid" ? walletChainSource(effectiveRemote) : null;
  const remoteSide: Side | null = effectiveRemote
    ? { address: remoteSource?.usdc ?? chainUsdc.address, symbol: remoteSource?.symbol ?? "USDC", decimals: 6, icon: stableLogo(remoteSource?.symbol ?? "USDC") }
    : null;
  const remoteChainName = effectiveRemote === "hyperliquid" ? "Hyperliquid" : effectiveRemote ? WALLET_CHAIN_NAMES[effectiveRemote] : chain.name;
  const remoteChainBadge = effectiveRemote === "hyperliquid" ? "hyperliquid" : (remoteSource?.chainId ?? chain.id);

  const cross = effectiveRemote !== null;
  const crossBuy = cross && side === "buy";
  const crossSell = cross && side === "sell";
  const route = !cross
    ? null
    : crossBuy
      ? fundsRoute(effectiveRemote === "hyperliquid" ? "hyperliquid" : "wallet", "wallet", { from: effectiveRemote === "hyperliquid" ? "arbitrum" : effectiveRemote!, to: chain.key }, () => hlNetwork)
      : fundsRoute("wallet", "wallet", { from: chain.key, to: effectiveRemote as WalletChain }, () => "mainnet");
  const steps = route?.kind === "steps" ? route.steps : [];
  const acrossIndex = steps.findIndex((step) => step.kind === "across");
  const acrossStep = acrossIndex >= 0 ? (steps[acrossIndex] as Extract<FundsStep, { kind: "across" }>) : null;

  const counterPrice = (entry: Side) => (DOLLARS.has(entry.symbol) ? 1 : listingOf(entry.address)?.price);
  const pay: Side = remoteSide ?? { ...localToken, icon: listingOf(localToken.address)?.icon };
  const asset: Side = { address: token.address, symbol: token.symbol, decimals: token.decimals, icon: token.icon };
  const sell = side === "buy" ? pay : asset;
  const buy = side === "buy" ? asset : pay;
  const payPrice = counterPrice(pay);
  const sellPrice = side === "buy" ? payPrice : token.price;
  const buyPrice = side === "buy" ? token.price : payPrice;

  const balances = useBalances(chain, owner, [localToken.address, asset.address], refresh);
  const remoteWallet = useUsdcBalance(crossBuy && remoteSource ? remoteSource : null, owner, refresh);
  const remoteBalance = effectiveRemote === "hyperliquid" ? (accounts.hyperliquid?.withdrawable ?? null) : remoteWallet;
  const sellBalance = crossBuy ? null : balances ? balances[sell.address.toLowerCase()] : undefined;
  const sellBalanceShown = crossBuy ? remoteBalance : sellBalance !== undefined && sellBalance !== null ? fromBaseUnits(sellBalance, sell.decimals) : null;

  const locked = (run !== null && run.phase !== "done") || bridged !== null;
  const value = Number(amount) || 0;
  const units = crossBuy ? usdcUnits(amount) : inputUnits(amount, sell.decimals, sellBalance ?? undefined);
  // Cross-chain buys bridge first: the Across leg's input is the amount (after Hyperliquid's withdrawal fee).
  const withdrawFirst = steps[0]?.kind === "hlWithdraw";
  const afterFee = withdrawFirst && units !== null ? usdcUnits(String(Math.floor((value - HL_WITHDRAW_FEE_USDC) * 1e6) / 1e6)) : units;
  // Selling cross-chain swaps to this chain's USDC first; the bridge preview takes that output.
  const sellQuote = useQuote({
    chainId: chain.id,
    tokenIn: asset.address,
    tokenOut: chainUsdc.address,
    amount: crossSell && !tokenIsUsdc ? units : null,
    swapper: owner,
    slippageBps,
  });
  const acrossInput = crossBuy ? (acrossIndex === 0 ? units : afterFee) : crossSell ? (tokenIsUsdc ? units : (sellQuote.quote?.outAmount ?? null)) : null;
  const across = useAcrossPreview(acrossStep, acrossInput, owner);
  // What the swap leg spends on this chain: the bridged USDC (buys) or the typed amount.
  const landed = crossBuy ? (bridged ?? (acrossStep ? (across?.out ?? null) : afterFee)) : null;
  const swapQuote = useQuote({
    chainId: chain.id,
    tokenIn: crossBuy ? chainUsdc.address : sell.address,
    tokenOut: buy.address,
    amount: crossSell || (crossBuy && tokenIsUsdc) ? null : crossBuy ? landed : units,
    swapper: owner,
    slippageBps,
  });
  const quote = crossSell ? sellQuote.quote : swapQuote.quote;
  const loading = swapQuote.loading || sellQuote.loading;

  const receiveUnits = crossSell
    ? (across?.out ?? null)
    : crossBuy && tokenIsUsdc
      ? landed
      : (swapQuote.quote?.outAmount ?? null);
  const receive =
    receiveUnits !== null
      ? fromBaseUnits(receiveUnits, crossSell || tokenIsUsdc ? 6 : buy.decimals)
      : sellPrice && buyPrice && value > 0
        ? (value * sellPrice) / buyPrice
        : null;
  const sellUsd = sellPrice ? value * sellPrice : null;
  const receiveUsd = receive !== null && buyPrice ? receive * buyPrice : null;
  const minOut = !cross && quote?.minOutAmount ? fromBaseUnits(quote.minOutAmount, buy.decimals) : null;
  const quoteError = crossSell ? sellQuote.error : swapQuote.error;

  const error =
    value <= 0 || bridged !== null
      ? null
      : units === null
        ? "Enter a valid amount."
        : cross && route?.kind !== "steps"
          ? route?.kind === "testnet"
            ? "Bridging needs mainnet."
            : "This route isn't available."
          : crossBuy && stepsError(steps, value, effectiveRemote === "hyperliquid" ? (remoteBalance ?? undefined) : undefined, pay.symbol)
            ? stepsError(steps, value, effectiveRemote === "hyperliquid" ? (remoteBalance ?? undefined) : undefined, pay.symbol)
            : crossBuy && remoteBalance !== null && value > remoteBalance + 1e-9
              ? `Not enough ${pay.symbol} on ${remoteChainName}.`
              : !crossBuy && sellBalance !== undefined && sellBalance !== null && units > sellBalance
                ? `Not enough ${sell.symbol} on ${chain.name}.`
                : (across?.error ?? quoteError ?? null);
  const ready = cross ? receiveUnits !== null : Boolean(quote);
  const canSwap = Boolean(owner) && ready && !error && !placing && !locked;

  useEffect(() => setArmed(false), [side, amount, counter]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const flip = () => {
    setSide((current) => (current === "buy" ? "sell" : "buy"));
    setAmount(receive && receive > 0 ? String(Number(receive.toPrecision(6))) : "");
  };

  /** One Uniswap swap on this chain; resolves to what it delivered, or null when it failed (a toast says why). */
  const swapOnChain = async (tokenIn: Side, tokenOut: Side, amountIn: bigint) => {
    if (!owner || !wallet) return null;
    try {
      const [{ uniswapSwap }, viem] = await Promise.all([import("@/lib/venues/uniswap/venue"), viemChain(chain)]);
      const result = await uniswapSwap({
        provider: wallet.provider,
        account: owner,
        chain: viem,
        tokenIn,
        tokenOut,
        amount: amountIn,
        slippageBps,
        maxPriceImpactPct: MAX_SPOT_PRICE_IMPACT_PCT,
      });
      const bought = tokenOut.address === asset.address;
      const tokenAmount = fromBaseUnits(bought ? result.outAmount : result.inAmount, asset.decimals);
      const other = bought ? tokenIn : tokenOut;
      const otherAmount = fromBaseUnits(bought ? result.inAmount : result.outAmount, other.decimals);
      const usd = otherAmount * (counterPrice(other) ?? 0);
      toast({
        tone: "success",
        title: `${bought ? "Bought" : "Sold"} ${amountText(tokenAmount)} ${token.symbol}`,
        message: `${bought ? "Spent" : "Received"} ${amountText(otherAmount)} ${other.symbol} on Uniswap · ${chain.name}${result.gasless ? " (gasless)" : ""}`,
        link: { href: result.explorerUrl, label: "View transaction" },
      });
      recordSwap(owner, { tx: result.txHash, at: Date.now(), chain: chain.key, token: token.address, symbol: token.symbol, side: bought ? "buy" : "sell", amount: tokenAmount, usd });
      trackTrade({ venue: "uniswap", side: bought ? "buy" : "sell", usd: Math.round(usd * 100) / 100, feeBps: null, newsId: null, oneClick: preferences.oneClickTrading });
      return result.outAmount;
    } catch (caught) {
      toast({
        tone: "error",
        title: "Uniswap swap failed",
        message: caught instanceof Error ? caught.message : String(caught),
        link: caught instanceof Error && "explorerUrl" in caught && typeof caught.explorerUrl === "string" && caught.explorerUrl ? { href: caught.explorerUrl, label: "View transaction" } : undefined,
      });
      return null;
    }
  };

  const submit = async () => {
    if (!owner || !wallet) return openWallets();
    if (!canSwap || units === null) return;
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setArmed(false);
    if (crossBuy) {
      // Bridge in; the swap waits for the USDC to land and a press (`bridged`).
      pendingFinish.current = tokenIsUsdc ? "USDC" : "swap";
      return void execute({ steps, index: 0, phase: "ready", carry: units });
    }
    setPlacing(true);
    try {
      if (crossSell) {
        // Swap to this chain's USDC, then bridge what it delivered.
        const out = tokenIsUsdc ? units : await swapOnChain(asset, { ...chainUsdc }, units);
        if (out === null) return;
        pendingFinish.current = remoteSource?.symbol ?? "USDC";
        void execute({ steps, index: 0, phase: "ready", carry: out });
        return;
      }
      if (await swapOnChain(sell, buy, units)) setAmount("");
    } finally {
      setPlacing(false);
      setRefresh((count) => count + 1);
    }
  };

  /** The swap after a cross-chain buy's bridge: the USDC that landed. */
  const swapBridged = async () => {
    if (bridged === null) return;
    setPlacing(true);
    try {
      if (await swapOnChain({ ...chainUsdc }, asset, bridged)) {
        setBridged(null);
        setRun(null);
        setAmount("");
      }
    } finally {
      setPlacing(false);
      setRefresh((count) => count + 1);
    }
  };

  const face = (entry: Side, chainName: string, badge: number | string) => (
    <>
      <CoinIcon src={entry.icon} symbol={entry.symbol} chain={badge} size={24} />
      <span className="flex flex-col items-start leading-tight">
        {entry.symbol}
        <span className="text-[10px] font-medium text-app-muted">{chainName}</span>
      </span>
    </>
  );
  const assetPill = (
    <button type="button" aria-label="Token" title="Pick another token" onClick={openSearch} disabled={locked} className={`${pillClass} hover:bg-app-selected disabled:opacity-60`}>
      {face(asset, chain.name, chain.id)}
      <ChevronDown className="size-4 text-app-muted" aria-hidden />
    </button>
  );
  const counterOptions: Array<PickerOption<string>> = [
    ...localOptions.map((entry) => ({
      value: counterValue({ kind: "local", address: entry.address }),
      label: `${entry.symbol} · ${chain.name}`,
      icon: <CoinIcon src={listingOf(entry.address)?.icon ?? stableLogo(entry.symbol)} symbol={entry.symbol} chain={chain.id} size={20} />,
    })),
    ...remoteChains.map((entry) => {
      const source = walletChainSource(entry);
      return {
        value: counterValue({ kind: "remote", from: entry }),
        label: `${source.symbol} · ${WALLET_CHAIN_NAMES[entry]}`,
        icon: <CoinIcon src={stableLogo(source.symbol)} symbol={source.symbol} chain={source.chainId} size={20} />,
        note: "bridge",
      };
    }),
    // Hyperliquid pays in (a withdrawal), it can't receive a sale.
    ...(side === "buy" && hlNetwork === "mainnet"
      ? [{ value: "remote:hyperliquid", label: "USDC · Hyperliquid", icon: <CoinIcon src={stableLogo("USDC")} symbol="USDC" chain="hyperliquid" size={20} />, note: "withdraw" }]
      : []),
  ];
  const counterPill = (
    <Picker
      label={side === "buy" ? "Pay with" : "Receive"}
      value={effectiveRemote ? counterValue({ kind: "remote", from: effectiveRemote }) : counterValue({ kind: "local", address: localToken.address })}
      options={counterOptions}
      disabled={locked}
      onChange={(next) => {
        setCounter(readCounter(next));
        setAmount("");
      }}
      buttonClassName={`${pillClass} hover:bg-app-selected disabled:opacity-60`}
    >
      {face(pay, remoteChainName, remoteChainBadge)}
    </Picker>
  );
  const box = "flex flex-col gap-2 rounded-2xl border border-app-hairline bg-app-chip/30 p-3";
  const rate = receive && value > 0 && !(tokenIsUsdc && cross) ? (side === "buy" ? value / receive : receive / value) : null;
  const pureBridge = cross && tokenIsUsdc;
  const swapLabel = `Swap ${chainUsdc.symbol} → ${token.symbol} on Uniswap · ${chain.name} (one signature)`;
  const checklist = !cross ? [] : crossBuy ? [...steps.map(stepLabel), ...(pureBridge ? [] : [swapLabel])] : [...(pureBridge ? [] : [`Swap ${token.symbol} → USDC on Uniswap · ${chain.name}`]), ...steps.map(stepLabel)];
  const doneSteps = !cross ? 0 : crossBuy ? (bridged !== null ? steps.length : run ? run.index : 0) : run ? (pureBridge ? 0 : 1) + run.index : 0;
  const shareBalance = crossBuy ? null : (sellBalance ?? null);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-app-ink">{pureBridge ? "Bridge" : "Swap"}</span>
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
              disabled={locked}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className={`min-w-0 flex-1 bg-transparent ${amountSize(amount)} font-semibold tabular-nums text-app-ink outline-hidden placeholder:text-app-faint`}
            />
            {side === "buy" ? counterPill : assetPill}
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="mr-auto tabular-nums text-app-faint">{sellUsd ? `≈ ${formatPrice(sellUsd)}` : "$0.00"}</span>
            {!locked &&
              (shareBalance !== null || sellBalanceShown !== null) &&
              SHARES.map((share) => (
                <button
                  key={share}
                  type="button"
                  onClick={() => {
                    if (shareBalance === null) return setAmount(String(Math.floor(((sellBalanceShown ?? 0) * share) / 100 * 1e6) / 1e6));
                    // Selling ETH keeps a little back for gas.
                    const reserve = isNativeToken(sell.address) ? (GAS_RESERVE_WEI[chain.id] ?? 0n) : 0n;
                    const spendable = shareBalance > reserve ? shareBalance - reserve : 0n;
                    setAmount(String(fromBaseUnits((spendable * BigInt(share)) / 100n, sell.decimals)));
                  }}
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
          disabled={locked}
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
            {side === "buy" ? assetPill : counterPill}
          </div>
          <span className="text-[12px] tabular-nums text-app-faint">{receiveUsd ? `≈ ${formatPrice(receiveUsd)}` : "$0.00"}</span>
        </div>
      </div>

      {rate && (
        <p className="text-[12px] tabular-nums text-app-muted">
          1 {token.symbol} ≈ {DOLLARS.has(pay.symbol) ? formatPrice(rate) : amountText(rate)} {pay.symbol}
          <span className="text-app-faint">
            {" · "}Uniswap on {chain.name}
            {cross ? " + Across" : quote ? (quote.settle === "order" ? ", gasless (UniswapX)" : quote.route.length ? ` via ${quote.route.join(", ")}` : "") : ""}
            {loading && <span aria-hidden className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-app-accent align-middle" />}
          </span>
        </p>
      )}
      {cross && checklist.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-app-hairline p-2.5">
          <p className="text-[12px] text-app-ink">
            {pureBridge
              ? `Across moves your ${sell.symbol} from ${side === "buy" ? remoteChainName : chain.name} to ${side === "buy" ? chain.name : remoteChainName}${sell.symbol !== buy.symbol ? ` and converts it to ${buy.symbol} (about 1:1)` : ""}.`
              : crossBuy
                ? `Your ${pay.symbol} on ${remoteChainName} is bridged to ${chain.name} as USDC, then swapped for ${token.symbol} on Uniswap.`
                : `${token.symbol} is swapped for USDC on ${chain.name}, then bridged to ${remoteChainName}${pay.symbol !== "USDC" ? ` as ${pay.symbol}` : ""}.`}
            {across?.feeUsd !== undefined && <span className="text-app-muted"> Bridge fee {across.feeUsd < 0.01 ? "< $0.01" : `$${across.feeUsd.toFixed(2)}`}.</span>}
          </p>
          <ol className="flex flex-col gap-1">
            {checklist.map((label, index) => {
              const done = index < doneSteps;
              const current = index === doneSteps && (run !== null || bridged !== null);
              return (
                <li key={index} className={`flex items-start gap-2 text-[11px] ${current ? "font-semibold text-app-ink" : done ? "text-app-up" : "text-app-faint"}`}>
                  <span className={`mt-px grid size-4 shrink-0 place-items-center rounded-full text-[10px] ${done ? "bg-app-up text-black" : current ? "bg-app-accent text-app-on-accent" : "bg-app-chip"}`}>
                    {done ? "✓" : index + 1}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>
          {run?.phase === "waiting" && (
            <p className="text-[11px] text-app-muted">
              {run.wait?.kind === "arrival" ? "Waiting for the USDC to land on Arbitrum…" : `Across is filling on ${run.wait?.to.name}…`} You can keep trading; we&apos;ll tell you when
              it&apos;s there.
            </p>
          )}
        </div>
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
            {crossBuy ? ` · ${remoteChainName}` : ""}
          </DetailRow>
          <DetailRow label="Est. amount">{receive ? `${amountText(receive)} ${buy.symbol}${crossSell ? ` · ${remoteChainName}` : ""}` : "—"}</DetailRow>
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
          {!pureBridge && (
            <DetailRow label="Max slippage" tone={slippageBps === null ? "muted" : undefined}>
              {slippageBps === null ? "Auto" : bpsToPercent(slippageBps)}
            </DetailRow>
          )}
          {quote && quote.feeBps > 0 && <DetailRow label="Platform fee">{bpsToPercent(quote.feeBps)}</DetailRow>}
          {cross && across?.feeUsd !== undefined && <DetailRow label="Bridge fee">{across.feeUsd < 0.01 ? "< $0.01" : `$${across.feeUsd.toFixed(2)}`}</DetailRow>}
          {withdrawFirst && <DetailRow label="Withdrawal fee">{`${HL_WITHDRAW_FEE_USDC} USDC`}</DetailRow>}
          {quote && quote.gasFeeUsd !== null && (
            <DetailRow label="Network fee" tone={quote.gasFeeUsd === 0 ? "muted" : undefined}>
              {quote.gasFeeUsd === 0 ? "None (gasless)" : quote.gasFeeUsd < 0.01 ? "< $0.01" : `~$${quote.gasFeeUsd.toFixed(2)}`}
            </DetailRow>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-app-down">{error}</p>}
      {bridged !== null ? (
        <button type="button" disabled={placing} onClick={() => void swapBridged()} className="h-11 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent disabled:opacity-50">
          {placing ? "Confirm in your wallet…" : `Swap ${units6(bridged).toFixed(2)} USDC → ${token.symbol}`}
        </button>
      ) : run && run.phase !== "done" ? (
        <button
          type="button"
          disabled={run.phase !== "ready"}
          onClick={() => void execute(run)}
          className="h-11 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent disabled:opacity-50"
        >
          {run.phase === "busy" ? "Confirm in your wallet…" : run.phase === "waiting" ? "Bridging…" : `Continue: ${continueLabel(run.steps[run.index], run.carry)}`}
        </button>
      ) : (
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
                  ? !ready && !error
                    ? "Getting a quote…"
                    : `${pureBridge ? "Bridge" : cross ? (crossBuy ? "Bridge & swap" : "Swap & bridge") : "Swap"} ${amountText(value)} ${sell.symbol} → ${buy.symbol}`
                  : "Enter an amount"}
        </button>
      )}
    </div>
  );
}
