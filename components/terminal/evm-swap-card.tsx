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
import { WALLET_CHAINS, fundsRoute, stepsError, walletChainSource, type FundsStep, type WalletChain } from "@/lib/venues/bridge-routes";
import { HL_WITHDRAW_FEE_USDC, sourceChainById, usdcUnits } from "@/lib/venues/deposits";
import { MAX_SPOT_PRICE_IMPACT_PCT } from "@/lib/trading/presets";
import { bpsToPercent } from "@/lib/trading/slippage";
import { fromBaseUnits, toBaseUnits } from "@/lib/venues/jupiter/amounts";
import { EVM_SWAP_CHAINS, evmRef, evmSwapChain, isNativeToken, sameAddress, wrappedNative, type EvmSwapChain, type EvmSwapToken } from "@/lib/venues/uniswap/chains";
import type { BridgeLegRef, DirectQuote, DirectSwapRequest } from "@/lib/venues/bridge-leg";
import { WSOL_MINT } from "@/lib/venues/jupiter/config";
import { LIFI_NATIVE_SOL, LIFI_SOLANA_CHAIN } from "@/lib/venues/lifi";
import { fetchUniswapQuote } from "@/lib/venues/uniswap/client";
import { fetchAggregatorQuote, type EvmSwapQuote } from "@/lib/venues/aggregators/client";
import { AGGREGATOR_NAMES, AGGREGATOR_PROVIDERS, type AggregatorProvider } from "@/lib/venues/aggregators/types";
import { useOffServices } from "@/components/app/service-status";
import { venueAvailable } from "@/lib/deployment";
import type { OrderSide } from "@/lib/venues/types";
import { useAssetSearch, type TokenChoice } from "./asset-search";
import { DetailRow, PrivateNote, PrivateToggle, SlippageSettings, amountSize, amountText, pillClass, useUsdcBalance } from "./swap-card";
import { recordSwap } from "./swap-history-store";
import { CoinIcon, stableLogo } from "./token-icon";
import { useTrading } from "./trading-provider";
import { continueLabel, errorMessage, stepLabel, units6, useFundsRun } from "./use-funds-run";
import { useEvmToken, type EvmToken } from "./use-evm-token";
import { useSpotListings } from "./use-spot-listings";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useSolanaBalance } from "./use-solana-balance";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

const ARM_MS = 5_000;
const QUOTE_DEBOUNCE_MS = 500;
const QUOTE_REFRESH_MS = 15_000;
const BALANCE_REFRESH_MS = 15_000;
const SHARES = [25, 50, 75, 100];
const DOLLARS = new Set(["USDC", "USDT", "USDG"]);
/** ETH a "Max" keeps back for gas: mainnet gas costs more than an L2's. */

/** A side of the swap: an EVM token (0x address) or, across chains, a Solana mint. */
type Side = { address: string; symbol: string; decimals: number; icon?: string };
const evmSide = (side: Side) => side as Pick<EvmSwapToken, "address" | "symbol" | "decimals">;

/**
 * The other side of the swap: any token on any chain (same chain → Uniswap; another chain's dollar → the Across/Relay/LI.FI
 * bridge plus Uniswap; anything else across chains, Solana included (`LIFI_SOLANA_CHAIN`, a mint as the address) → Relay
 * or LI.FI in one go), or the Hyperliquid balance (a withdrawal).
 */
type Counter = { kind: "token"; chainId: number; address: string; symbol: string; decimals?: number; icon?: string; price?: number } | { kind: "hyperliquid" };

const HL_PICK = "hyperliquid";
const RELAY_POLL_MS = 3_000;
const RELAY_TIMEOUT_MS = 10 * 60_000;
const QUOTE_ONLY_USER = "0x000000000000000000000000000000000000dEaD";
/** Solana's docs' sample address: quotes before a Solana wallet connects. */
const QUOTE_ONLY_SOLANA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";

const rpcFor = (chainId: number | null) => (chainId === null ? null : (evmSwapChain(chainId)?.rpc ?? (chainId === 4663 ? ROBINHOOD_RPC : null)));
const chainNameOf = (chainId: number) => (chainId === LIFI_SOLANA_CHAIN ? "Solana" : undefined) ?? evmSwapChain(chainId)?.name ?? sourceChainById(chainId)?.name ?? `Chain ${chainId}`;

function tokenCounter(chainId: number, token: { address: string; symbol: string; decimals: number }, icon?: string): Counter {
  return { kind: "token", chainId, address: token.address, symbol: token.symbol, decimals: token.decimals, icon };
}

/** The wallet's balances of `tokens` on the chain, refreshed while the tab is visible. */
function useBalances(rpc: string | null, owner: `0x${string}` | null, tokens: string[], refresh: number) {
  const key = owner && rpc ? `${rpc}:${owner}:${tokens.join(",")}:${refresh}` : null;
  const [state, setState] = useState<{ key: string; amounts: Record<string, bigint> } | null>(null);
  useEffect(() => {
    if (!key || !owner || !rpc) return;
    let active = true;
    const load = async () => {
      try {
        const { createPublicClient, erc20Abi, http } = await import("viem");
        const client = createPublicClient({ transport: http(rpc) });
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

/** The aggregators asked next to Uniswap: switched on in Settings, set up on this site, and not turned off by an admin. */
function useAggregators(): AggregatorProvider[] {
  const { preferences } = usePreferences();
  const { off } = useOffServices();
  const switchedOn: Record<AggregatorProvider, boolean> = { zerox: preferences.venueZerox, odos: preferences.venueOdos, kyberswap: preferences.venueKyberswap };
  return AGGREGATOR_PROVIDERS.filter((provider) => venueAvailable(provider) && switchedOn[provider] && !off.includes(`swap:${provider}`));
}

/**
 * A debounced exact-input quote, refreshed every few seconds: Uniswap and the enabled aggregators (0x, Odos, KyberSwap) asked
 * together, the largest output wins. All carry the same fee, so the best price for the trader is the one that runs.
 * Private swaps ask Uniswap for UniswapX orders only (the aggregators' transactions would go through the public mempool).
 */
function useQuote(input: { chainId: number; tokenIn: string; tokenOut: string; amount: bigint | null; swapper: string | null; slippageBps: number | null }) {
  const { preferences } = usePreferences();
  const privateOnly = preferences.privateSwap;
  const enabledAggregators = useAggregators();
  const aggregators = privateOnly ? [] : enabledAggregators;
  const key =
    input.amount && input.amount > 0n ? [input.chainId, input.tokenIn, input.tokenOut, input.amount, input.swapper, input.slippageBps, aggregators.join(","), privateOnly].join("|") : null;
  const [state, setState] = useState<{ key: string; quote?: EvmSwapQuote; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!key || !input.amount) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const request = { ...input, amount: input.amount! };
        const results = await Promise.allSettled([
          fetchUniswapQuote({ ...request, privateOnly }).then((quote): EvmSwapQuote => ({ ...quote, provider: "uniswap" })),
          ...aggregators.map((provider) => fetchAggregatorQuote(provider, request)),
        ]);
        const quotes = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
        const best = quotes.reduce<EvmSwapQuote | null>((winner, quote) => (!winner || quote.outAmount > winner.outAmount ? quote : winner), null);
        if (!best) throw (results[0] as PromiseRejectedResult).reason;
        if (active) setState({ key, quote: best });
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
        const { quoteBridgeLeg, noRouteReason } = await import("@/lib/venues/bridge-leg");
        const result = await quoteBridgeLeg({ from: step.from, to: step.to, units, depositor: owner, recipient: owner });
        const summary = result.best;
        if (active) setState(summary ? { key, out: summary.expectedOut, feeUsd: summary.feeUsd } : { key, error: noRouteReason(result) });
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

/** Decimals of a Solana token picked from the search (Jupiter's token data). */
function useSolanaDecimals(mint: string | null) {
  const [state, setState] = useState<{ mint: string; decimals: number } | null>(null);
  useEffect(() => {
    if (!mint) return;
    let active = true;
    void fetch(`/api/jup/token?mint=${mint}`)
      .then((response) => response.json() as Promise<{ token?: { decimals?: number } | null }>)
      .then((body) => {
        if (active && Number.isInteger(body.token?.decimals)) setState({ mint, decimals: body.token!.decimals! });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mint]);
  return mint && state?.mint === mint ? state.decimals : undefined;
}

/**
 * A debounced cross-chain quote for any token pair (the "direct" route): Relay and LI.FI asked together, the larger
 * output kept; refreshed every few seconds.
 */
function useDirect(request: DirectSwapRequest | null) {
  const key = request && request.amount > 0n ? [request.fromChain, request.fromToken, request.toChain, request.toToken, request.amount, request.fromAddress, request.toAddress, request.slippageBps].join("|") : null;
  const [state, setState] = useState<{ key: string; quote?: DirectQuote; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!key || !request) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const { quoteDirectSwap } = await import("@/lib/venues/bridge-leg");
        const result = await quoteDirectSwap(request);
        if (active) setState(result.best ? { key, quote: result.best } : { key, error: result.error ?? "No route for this swap right now." });
      } catch (caught) {
        if (active) setState({ key, error: errorMessage(caught) });
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
  if (chain.key === "robinhood") {
    const { robinhoodChain } = await import("@/lib/venues/arcus/config");
    return robinhoodChain("mainnet");
  }
  const { arbitrum, avalanche, base, bsc, hyperEvm, mainnet, monad, optimism, polygon, unichain } = await import("viem/chains");
  const known = [mainnet, base, arbitrum, bsc, hyperEvm, polygon, optimism, avalanche, unichain, monad].find((entry) => entry.id === chain.id)!;
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
  const solana = useSolanaWallet();
  const { open: openWallets } = useWalletModal();
  const { open: openSearch, pickToken } = useAssetSearch();
  const { network: hlNetwork, accounts } = useTrading();
  const toast = useToast();
  const router = useRouter();
  const listings = useSpotListings();
  const chain = token.chain;
  const chainUsdc = chain.pay[0];
  const tokenIsUsdc = sameAddress(token.address, chainUsdc.address);
  const localOptions = chain.pay.filter((entry) => !sameAddress(entry.address, token.address));
  // The bridge path (Across, Hyperliquid withdrawals) serves the wallet chains only; on BNB Chain another chain's dollar
  // goes through Relay or LI.FI like any other token.
  const bridgeable = (WALLET_CHAINS as readonly string[]).includes(chain.key);
  const remoteChains = WALLET_CHAINS.filter((entry) => entry !== chain.key);
  const remoteDollar = (from: WalletChain): Counter => {
    const source = walletChainSource(from);
    return tokenCounter(source.chainId, { address: source.usdc, symbol: source.symbol, decimals: 6 }, stableLogo(source.symbol));
  };
  // A dollar token starts on another chain's dollar (a bridge); anything else on this chain's first pay token.
  const [counter, setCounter] = useState<Counter>(() => {
    return DOLLARS.has(token.symbol) && bridgeable ? remoteDollar(remoteChains[0]) : tokenCounter(chain.id, localOptions[0], stableLogo(localOptions[0].symbol));
  });
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [armed, setArmed] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  // USDC a cross-chain buy delivered to this chain, waiting for the swap press.
  const [bridged, setBridged] = useState<bigint | null>(null);
  // A direct (Relay or LI.FI) cross-chain swap sent and waiting for its fill.
  const [directPending, setDirectPending] = useState<{
    ref: BridgeLegRef;
    id: string;
    provider: DirectQuote["provider"];
    name: string;
    originChainId: number;
    explorerUrl: string;
    since: number;
    side: OrderSide;
    tokenAmount: number;
    other: { amount: number; symbol: string };
    usd: number;
  } | null>(null);
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

  const listingOf = (address: string, chainId = chain.id) => {
    const swapChain = evmSwapChain(chainId);
    return (
      listings?.find((listing) => listing.id === uniswapListingId(chainId, address)) ??
      (swapChain && isNativeToken(address) ? listings?.find((listing) => listing.id === uniswapListingId(chainId, wrappedNative(swapChain).address)) : undefined)
    );
  };
  // Decimals of a counter token picked from the search (the Uniswap list has them; else the contract).
  const onSolana = counter.kind === "token" && counter.chainId === LIFI_SOLANA_CHAIN;
  const solanaDecimals = useSolanaDecimals(onSolana && counter.kind === "token" && counter.decimals === undefined ? counter.address : null);
  const counterMeta = useEvmToken(counter.kind === "token" && counter.decimals === undefined && evmSwapChain(counter.chainId) ? evmRef(counter.chainId, counter.address) : undefined);
  const counterDecimals = counter.kind === "token" ? (counter.decimals ?? (onSolana ? solanaDecimals : counterMeta?.decimals)) : 6;
  const counterChainId = counter.kind === "token" ? counter.chainId : null;
  const sameChain = counterChainId === chain.id;
  // Another chain's dollar (USDC, or USDG on Robinhood) goes the bridge way; any other token there (or on Solana) goes
  // through Relay or LI.FI.
  const dollarRemote =
    counter.kind === "token" && !sameChain && bridgeable
      ? (WALLET_CHAINS.find((entry) => {
          const source = walletChainSource(entry);
          return source.chainId === counter.chainId && sameAddress(source.usdc, counter.address);
        }) ?? null)
      : null;
  const remote = counter.kind === "hyperliquid" && bridgeable ? "hyperliquid" : dollarRemote;
  // Selling into another chain can't land in a venue account (that's Deposit): it falls back to this chain's USDC.
  const effectiveRemote = remote === "hyperliquid" && side === "sell" ? null : remote;
  const direct = counter.kind === "token" && !sameChain && !dollarRemote;
  const localToken: Side =
    counter.kind === "token" && sameChain
      ? { address: counter.address, symbol: counter.symbol, decimals: counterDecimals ?? 18, icon: counter.icon }
      : { ...chainUsdc, icon: stableLogo(chainUsdc.symbol) };
  const remoteSource = effectiveRemote && effectiveRemote !== "hyperliquid" ? walletChainSource(effectiveRemote) : null;
  const remoteSide: Side | null = effectiveRemote
    ? { address: remoteSource?.usdc ?? chainUsdc.address, symbol: remoteSource?.symbol ?? "USDC", decimals: 6, icon: stableLogo(remoteSource?.symbol ?? "USDC") }
    : direct && counter.kind === "token"
      ? { address: counter.address, symbol: counter.symbol, decimals: counterDecimals ?? 18, icon: counter.icon }
      : null;
  const remoteChainName = effectiveRemote === "hyperliquid" ? "Hyperliquid" : effectiveRemote || direct ? chainNameOf(counterChainId!) : chain.name;
  const remoteChainBadge = effectiveRemote === "hyperliquid" ? "hyperliquid" : onSolana ? "solana" : effectiveRemote || direct ? counterChainId! : chain.id;

  const cross = effectiveRemote !== null;
  const crossBuy = cross && side === "buy";
  const crossSell = cross && side === "sell";
  const route = !cross
    ? null
    : crossBuy
      ? // `cross` needs `bridgeable`, so this chain is a wallet chain here.
        fundsRoute(effectiveRemote === "hyperliquid" ? "hyperliquid" : "wallet", "wallet", { from: effectiveRemote === "hyperliquid" ? "arbitrum" : effectiveRemote!, to: chain.key as WalletChain }, () => hlNetwork)
      : fundsRoute("wallet", "wallet", { from: chain.key as WalletChain, to: effectiveRemote as WalletChain }, () => "mainnet");
  const steps = route?.kind === "steps" ? route.steps : [];
  const acrossIndex = steps.findIndex((step) => step.kind === "across");
  const acrossStep = acrossIndex >= 0 ? (steps[acrossIndex] as Extract<FundsStep, { kind: "across" }>) : null;

  const counterPrice = (entry: Side) =>
    DOLLARS.has(entry.symbol)
      ? 1
      : (listingOf(entry.address, direct ? counterChainId! : chain.id)?.price ?? (counter.kind === "token" && entry.address === counter.address ? counter.price : undefined));
  const pay: Side = remoteSide ?? { ...localToken, icon: localToken.icon ?? listingOf(localToken.address)?.icon };
  const asset: Side = { address: token.address, symbol: token.symbol, decimals: token.decimals, icon: token.icon };
  const sell = side === "buy" ? pay : asset;
  const buy = side === "buy" ? asset : pay;
  const payPrice = counterPrice(pay);
  const sellPrice = side === "buy" ? payPrice : token.price;
  const buyPrice = side === "buy" ? token.price : payPrice;

  const balances = useBalances(chain.rpc, owner, [localToken.address, asset.address], refresh);
  // A direct buy spends a token on another chain.
  const directBalances = useBalances(direct && side === "buy" && !onSolana ? rpcFor(counterChainId) : null, owner, [pay.address], refresh);
  const solanaBalance = useSolanaBalance(onSolana && side === "buy" ? solana.address : null, onSolana ? pay.address : null, refresh);
  const remoteWallet = useUsdcBalance(crossBuy && remoteSource ? remoteSource : null, owner, refresh);
  const remoteBalance = effectiveRemote === "hyperliquid" ? (accounts.hyperliquid?.withdrawable ?? null) : remoteWallet;
  const sellBalance = crossBuy
    ? null
    : direct && side === "buy" && onSolana
      ? solanaBalance
      : direct && side === "buy"
      ? directBalances
        ? (directBalances[pay.address.toLowerCase()] ?? 0n)
        : undefined
      : balances
        ? balances[sell.address.toLowerCase()]
        : undefined;
  const sellBalanceShown = crossBuy ? remoteBalance : sellBalance !== undefined && sellBalance !== null ? fromBaseUnits(sellBalance, sell.decimals) : null;

  const locked = (run !== null && run.phase !== "done") || bridged !== null || directPending !== null;
  // Solana on the other side needs a Solana wallet too (it pays, or it receives).
  const needsSolana = onSolana && !solana.address;
  const value = Number(amount) || 0;
  const decimalsKnown = counterDecimals !== undefined;
  const units = !decimalsKnown ? null : crossBuy ? usdcUnits(amount) : inputUnits(amount, sell.decimals, sellBalance ?? undefined);
  /** The direct route's request; Solana's side is paid from or paid to the Solana wallet. LI.FI calls native SOL 111…1. */
  const directRequest = (evmUser: string, solanaUser: string): DirectSwapRequest | null => {
    if (!direct || !units || counterChainId === null) return null;
    const lifiToken = (address: string) => (address === WSOL_MINT ? LIFI_NATIVE_SOL : address);
    return {
      fromChain: side === "buy" ? counterChainId : chain.id,
      toChain: side === "buy" ? chain.id : counterChainId,
      fromToken: lifiToken(sell.address),
      toToken: lifiToken(buy.address),
      amount: units,
      fromAddress: side === "buy" && onSolana ? solanaUser : evmUser,
      toAddress: side === "sell" && onSolana ? solanaUser : evmUser,
      slippageBps,
    };
  };
  const directQuote = useDirect(directRequest(owner ?? QUOTE_ONLY_USER, solana.address ?? QUOTE_ONLY_SOLANA));
  const directName = directQuote.quote?.name ?? "Relay or LI.FI";
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
    amount: direct || crossSell || (crossBuy && tokenIsUsdc) ? null : crossBuy ? landed : units,
    swapper: owner,
    slippageBps,
  });
  const quote = crossSell ? sellQuote.quote : swapQuote.quote;
  const loading = swapQuote.loading || sellQuote.loading || directQuote.loading;

  const receiveUnits = direct
    ? (directQuote.quote?.raw.expectedOut ?? null)
    : crossSell
      ? (across?.out ?? null)
      : crossBuy && tokenIsUsdc
        ? landed
        : (swapQuote.quote?.outAmount ?? null);
  const receive =
    receiveUnits !== null
      ? fromBaseUnits(receiveUnits, buy.decimals)
      : sellPrice && buyPrice && value > 0
        ? (value * sellPrice) / buyPrice
        : null;
  const sellUsd = sellPrice ? value * sellPrice : null;
  const receiveUsd = receive !== null && buyPrice ? receive * buyPrice : null;
  const minOut = !cross && quote?.minOutAmount ? fromBaseUnits(quote.minOutAmount, buy.decimals) : null;
  const quoteError = direct ? directQuote.error : crossSell ? sellQuote.error : swapQuote.error;

  const error =
    value <= 0 || bridged !== null
      ? null
      : !decimalsKnown
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
                ? `Not enough ${sell.symbol} on ${direct && side === "buy" ? remoteChainName : chain.name}.`
                : (across?.error ?? quoteError ?? null);
  const ready = direct ? Boolean(directQuote.quote) : cross ? receiveUnits !== null : Boolean(quote);
  const canSwap = Boolean(owner) && ready && !error && !placing && !locked;

  useEffect(() => setArmed(false), [side, amount, counter]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const flip = () => {
    // The Hyperliquid balance can pay but can't receive: selling lands in this chain's USDC instead.
    if (side === "buy" && counter.kind === "hyperliquid") setCounter(tokenCounter(chain.id, chainUsdc, stableLogo("USDC")));
    setSide((current) => (current === "buy" ? "sell" : "buy"));
    setAmount(receive && receive > 0 ? String(Number(receive.toPrecision(6))) : "");
  };

  // A direct swap fills on the destination in seconds to minutes: follow it, then report like any swap.
  useEffect(() => {
    if (!directPending || !owner) return;
    const pending = directPending;
    const timer = window.setInterval(async () => {
      const { bridgeLegState } = await import("@/lib/venues/bridge-leg");
      const state = await bridgeLegState(pending.ref, pending.originChainId).catch(() => "pending" as const);
      if (state === "pending" && Date.now() - pending.since < RELAY_TIMEOUT_MS) return;
      setDirectPending(null);
      setRefresh((count) => count + 1);
      if (state === "filled") {
        setAmount("");
        toast({
          tone: "success",
          title: `${pending.side === "buy" ? "Bought" : "Sold"} ${amountText(pending.tokenAmount)} ${token.symbol}`,
          message: `${pending.side === "buy" ? "Paid" : "Received"} ${amountText(pending.other.amount)} ${pending.other.symbol} through ${pending.name}`,
          link: { href: pending.explorerUrl, label: "View transaction" },
        });
        recordSwap(owner, { tx: pending.id, at: Date.now(), chain: chain.key, token: token.address, symbol: token.symbol, side: pending.side, amount: pending.tokenAmount, usd: pending.usd });
        trackTrade({ venue: pending.provider, side: pending.side, usd: Math.round(pending.usd * 100) / 100, feeBps: null, newsId: null, oneClick: preferences.oneClickTrading });
      } else {
        toast({
          tone: "error",
          title: state === "failed" ? "Swap refunded" : `${pending.name} is taking longer than usual`,
          message:
            state === "failed"
              ? `${pending.name} couldn't fill it and returned the funds on the origin chain.`
              : `Check the transaction; ${pending.name} refunds on the origin chain if it can't fill.`,
          link: { href: pending.explorerUrl, label: "View transaction" },
        });
      }
    }, RELAY_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poller per sent swap
  }, [directPending, owner]);

  /**
   * One swap on this chain through the source whose quote won (Uniswap, 0x or Odos); resolves to what it delivered,
   * or null when it failed (a toast says why).
   */
  const swapOnChain = async (tokenIn: Side, tokenOut: Side, amountIn: bigint, source: EvmSwapQuote["provider"] = "uniswap") => {
    if (!owner || !wallet) return null;
    const sourceName = source === "uniswap" ? "Uniswap" : AGGREGATOR_NAMES[source];
    try {
      const [{ uniswapSwap }, { aggregatorSwap }, viem] = await Promise.all([import("@/lib/venues/uniswap/venue"), import("@/lib/venues/aggregators/venue"), viemChain(chain)]);
      if (preferences.privateSwap && source !== "uniswap") throw new Error("Private swaps go through UniswapX only. Turn Private off to use " + AGGREGATOR_NAMES[source] + ".");
      const run = source === "uniswap" ? uniswapSwap : (args: Parameters<typeof uniswapSwap>[0]) => aggregatorSwap(source, args);
      const result = await run({
        provider: wallet.provider,
        account: owner,
        chain: viem,
        tokenIn: evmSide(tokenIn),
        tokenOut: evmSide(tokenOut),
        amount: amountIn,
        slippageBps,
        maxPriceImpactPct: MAX_SPOT_PRICE_IMPACT_PCT,
        // A private swap is a UniswapX order or nothing: never a transaction in the public mempool.
        privateOnly: preferences.privateSwap,
      });
      const bought = tokenOut.address === asset.address;
      const tokenAmount = fromBaseUnits(bought ? result.outAmount : result.inAmount, asset.decimals);
      const other = bought ? tokenIn : tokenOut;
      const otherAmount = fromBaseUnits(bought ? result.inAmount : result.outAmount, other.decimals);
      const usd = otherAmount * (counterPrice(other) ?? 0);
      toast({
        tone: "success",
        title: `${bought ? "Bought" : "Sold"} ${amountText(tokenAmount)} ${token.symbol}`,
        message: `${bought ? "Spent" : "Received"} ${amountText(otherAmount)} ${other.symbol} on ${sourceName} · ${chain.name}${result.gasless ? " (gasless)" : ""}`,
        link: { href: result.explorerUrl, label: "View transaction" },
      });
      recordSwap(owner, { tx: result.txHash, at: Date.now(), chain: chain.key, token: token.address, symbol: token.symbol, side: bought ? "buy" : "sell", amount: tokenAmount, usd });
      trackTrade({ venue: source, side: bought ? "buy" : "sell", usd: Math.round(usd * 100) / 100, feeBps: null, newsId: null, oneClick: preferences.oneClickTrading });
      return result.outAmount;
    } catch (caught) {
      toast({
        tone: "error",
        title: `${sourceName} swap failed`,
        message: caught instanceof Error ? caught.message : String(caught),
        link: caught instanceof Error && "explorerUrl" in caught && typeof caught.explorerUrl === "string" && caught.explorerUrl ? { href: caught.explorerUrl, label: "View transaction" } : undefined,
      });
      return null;
    }
  };

  const submit = async () => {
    if (!owner || !wallet || needsSolana) return openWallets();
    if (!canSwap || units === null) return;
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setArmed(false);
    if (direct && counterChainId !== null) {
      // Any token across chains: fresh Relay and LI.FI quotes, the better one's transaction on the origin chain (or
      // the Solana wallet's signature), then the fill.
      setPlacing(true);
      try {
        const originChainId = side === "buy" ? counterChainId : chain.id;
        const source = originChainId === LIFI_SOLANA_CHAIN ? null : (sourceChainById(originChainId) ?? null);
        if (originChainId !== LIFI_SOLANA_CHAIN && !source) throw new Error(`Swaps from ${chainNameOf(originChainId)} aren't supported yet.`);
        const request = directRequest(owner, solana.address ?? "");
        if (!request) return;
        const { quoteDirectSwap, sendDirectSwap } = await import("@/lib/venues/bridge-leg");
        const fresh = await quoteDirectSwap(request);
        if (!fresh.best) throw new Error(fresh.error ?? "No route for this swap right now.");
        const sent = await sendDirectSwap(fresh.best, { provider: wallet.provider, account: owner, source, solana: solana.signTransaction, units });
        const sold = fromBaseUnits(units, sell.decimals);
        const bought = fromBaseUnits(fresh.best.raw.expectedOut, buy.decimals);
        const otherPrice = counterPrice(pay);
        setDirectPending({
          ref: sent.ref,
          id: sent.id,
          provider: fresh.best.provider,
          name: fresh.best.name,
          originChainId,
          explorerUrl: sent.explorerUrl,
          since: Date.now(),
          side,
          tokenAmount: side === "buy" ? bought : sold,
          other: { amount: side === "buy" ? sold : bought, symbol: pay.symbol },
          usd: (side === "buy" ? sold : bought) * (otherPrice ?? 0) || (sellUsd ?? 0),
        });
      } catch (caught) {
        toast({ tone: "error", title: "Swap not sent", message: errorMessage(caught) });
      } finally {
        setPlacing(false);
      }
      return;
    }
    if (crossBuy) {
      // Bridge in; the swap waits for the USDC to land and a press (`bridged`).
      pendingFinish.current = tokenIsUsdc ? "USDC" : "swap";
      return void execute({ steps, index: 0, phase: "ready", carry: units });
    }
    setPlacing(true);
    try {
      if (crossSell) {
        // Swap to this chain's USDC, then bridge what it delivered.
        const out = tokenIsUsdc ? units : await swapOnChain(asset, { ...chainUsdc }, units, sellQuote.quote?.provider);
        if (out === null) return;
        pendingFinish.current = remoteSource?.symbol ?? "USDC";
        void execute({ steps, index: 0, phase: "ready", carry: out });
        return;
      }
      if (await swapOnChain(sell, buy, units, swapQuote.quote?.provider)) setAmount("");
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
  // Any token on any chain: the market search in pick mode, the chains' dollars and ETH (and Hyperliquid when buying) first.
  const pinnedCounters: TokenChoice[] = [
    ...EVM_SWAP_CHAINS.flatMap((entry) =>
      entry.pay
        .filter((payToken, index) => index === 0 || isNativeToken(payToken.address))
        .map((payToken) => ({
          mint: evmRef(entry.id, payToken.address),
          symbol: payToken.symbol,
          name: `${payToken.symbol} on ${entry.name}`,
          icon: listingOf(payToken.address, entry.id)?.icon ?? stableLogo(payToken.symbol),
          chainId: entry.id,
          decimals: payToken.decimals,
          verified: true,
          source: `Uniswap · ${entry.name}`,
        })),
    ),
    // Solana's SOL and USDC (LI.FI routes them; the search lists every other Solana token).
    ...[
      { mint: WSOL_MINT, symbol: "SOL", name: "SOL on Solana", icon: "/chains/solana.svg", decimals: 9 },
      { mint: SOLANA_USDC, symbol: "USDC", name: "USDC on Solana", icon: stableLogo("USDC"), decimals: 6 },
    ].map((entry) => ({ ...entry, verified: true, source: "Solana" })),
    ...(side === "buy" && hlNetwork === "mainnet" && bridgeable
      ? [{ mint: HL_PICK, symbol: "USDC", name: "Your Hyperliquid balance (withdrawal)", icon: stableLogo("USDC"), decimals: 6, verified: true, source: "Hyperliquid" }]
      : []),
  ];
  const pickCounter = () =>
    pickToken({
      title: side === "buy" ? "Pay with" : "Receive",
      scope: "evm",
      pinned: pinnedCounters,
      exclude: evmRef(chain.id, token.address),
      onPick: (picked) => {
        if (picked.mint === HL_PICK) setCounter({ kind: "hyperliquid" });
        else if (!picked.mint.startsWith("evm:")) {
          // A Solana mint: crossed with LI.FI.
          setCounter({ kind: "token", chainId: LIFI_SOLANA_CHAIN, address: picked.mint, symbol: picked.symbol, decimals: picked.decimals, icon: picked.icon, price: picked.price });
        } else {
          const [, id, address] = picked.mint.split(":");
          const chainId = picked.chainId ?? Number(id);
          if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "") || !Number.isFinite(chainId)) return;
          setCounter({ kind: "token", chainId, address, symbol: picked.symbol, decimals: picked.decimals, icon: picked.icon, price: picked.price });
        }
        setAmount("");
      },
    });
  const counterPill = (
    <button type="button" aria-label={side === "buy" ? "Pay with" : "Receive"} title="Pick any token on any chain" onClick={pickCounter} disabled={locked} className={`${pillClass} hover:bg-app-selected disabled:opacity-60`}>
      {face(pay, remoteChainName, remoteChainBadge)}
      <ChevronDown className="size-4 text-app-muted" aria-hidden />
    </button>
  );
  const box = "flex flex-col gap-2 rounded-2xl border border-app-hairline bg-app-chip/30 p-3";
  const rate = receive && value > 0 && !(tokenIsUsdc && cross) ? (side === "buy" ? value / receive : receive / value) : null;
  const pureBridge = cross && tokenIsUsdc;
  const swapLabel = `Swap ${chainUsdc.symbol} → ${token.symbol} on Uniswap · ${chain.name} (one signature)`;
  const directLabel = `${directName} swaps ${sell.symbol} on ${side === "buy" ? remoteChainName : chain.name} for ${buy.symbol} on ${side === "buy" ? chain.name : remoteChainName} (${side === "buy" && onSolana ? "one Solana signature" : "an approval when needed, then one transaction"}; seconds to minutes)`;
  const checklist = direct ? [directLabel] : !cross ? [] : crossBuy ? [...steps.map(stepLabel), ...(pureBridge ? [] : [swapLabel])] : [...(pureBridge ? [] : [`Swap ${token.symbol} → USDC on Uniswap · ${chain.name}`]), ...steps.map(stepLabel)];
  const doneSteps = direct ? 0 : !cross ? 0 : crossBuy ? (bridged !== null ? steps.length : run ? run.index : 0) : run ? (pureBridge ? 0 : 1) + run.index : 0;
  const shareBalance = crossBuy ? null : (sellBalance ?? null);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1">
        <span className="mr-auto text-[13px] font-semibold text-app-ink">{pureBridge ? "Bridge" : "Swap"}</span>
        <PrivateToggle />
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
      {!pureBridge && <PrivateNote routes={direct ? "Relay or LI.FI intents (a solver fills them)" : "UniswapX orders (fillers settle them off the mempool)"} />}
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
                    const reserve = isNativeToken(sell.address) ? chain.gasReserve : 0n;
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
            {" · "}
            {direct ? `${directName}, ${side === "buy" ? remoteChainName : chain.name} → ${side === "buy" ? chain.name : remoteChainName}` : `${quote && quote.provider !== "uniswap" ? AGGREGATOR_NAMES[quote.provider] : "Uniswap"} on ${chain.name}`}
            {direct ? "" : cross ? " + bridge" : quote ? (quote.settle === "order" ? ", gasless (UniswapX)" : quote.route.length ? ` via ${quote.route.join(", ")}` : "") : ""}
            {loading && <span aria-hidden className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-app-accent align-middle" />}
          </span>
        </p>
      )}
      {(cross || direct) && checklist.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-app-hairline p-2.5">
          <p className="text-[12px] text-app-ink">
            {direct
              ? `Your ${sell.symbol} on ${side === "buy" ? remoteChainName : chain.name} becomes ${buy.symbol} on ${side === "buy" ? chain.name : remoteChainName} in one cross-chain swap.`
              : pureBridge
              ? `Across, Relay or LI.FI moves your ${sell.symbol} from ${side === "buy" ? remoteChainName : chain.name} to ${side === "buy" ? chain.name : remoteChainName}${sell.symbol !== buy.symbol ? ` and converts it to ${buy.symbol} (about 1:1)` : ""}.`
              : crossBuy
                ? `Your ${pay.symbol} on ${remoteChainName} is bridged to ${chain.name} as USDC, then swapped for ${token.symbol} on Uniswap.`
                : `${token.symbol} is swapped for USDC on ${chain.name}, then bridged to ${remoteChainName}${pay.symbol !== "USDC" ? ` as ${pay.symbol}` : ""}.`}
            {direct && directQuote.quote && <span className="text-app-muted"> Route fee {directQuote.quote.raw.feeUsd < 0.01 ? "< $0.01" : `${directQuote.quote.raw.feeUsd.toFixed(2)}`}.</span>}
            {!direct && across?.feeUsd !== undefined && <span className="text-app-muted"> Bridge fee {across.feeUsd < 0.01 ? "< $0.01" : `$${across.feeUsd.toFixed(2)}`}.</span>}
          </p>
          <ol className="flex flex-col gap-1">
            {checklist.map((label, index) => {
              const done = index < doneSteps;
              const current = index === doneSteps && (run !== null || bridged !== null || directPending !== null);
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
              {run.wait?.kind === "arrival" ? "Waiting for the USDC to land on Arbitrum…" : `The bridge is filling on ${run.wait?.to.name}…`} You can keep trading; we&apos;ll tell you when
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
          {direct && directQuote.quote && (
            <>
              <DetailRow label="Route">{directQuote.quote.name}</DetailRow>
              <DetailRow label="Min. received">
                {amountText(fromBaseUnits(directQuote.quote.raw.minOut, buy.decimals))} {buy.symbol}
              </DetailRow>
              <DetailRow label="Route fee">{directQuote.quote.raw.feeUsd < 0.01 ? "< $0.01" : `${directQuote.quote.raw.feeUsd.toFixed(2)}`}</DetailRow>
            </>
          )}
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
      {directPending ? (
        <button type="button" disabled className="h-11 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent disabled:opacity-50">
          {directPending.name} is filling on {side === "buy" ? chain.name : remoteChainName}…
        </button>
      ) : bridged !== null ? (
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
          disabled={Boolean(owner) && !needsSolana && !canSwap}
          onClick={() => void submit()}
          className={`h-11 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 ${armed ? "bg-app-ink text-app-card" : "bg-app-accent text-app-on-accent hover:opacity-90"}`}
        >
          {!owner
            ? "Connect EVM wallet"
            : needsSolana
              ? "Connect Solana wallet"
              : placing
              ? "Confirm in your wallet…"
              : armed
                ? `Confirm: ${amountText(value)} ${sell.symbol} → ${buy.symbol}`
                : value > 0
                  ? !ready && !error
                    ? "Getting a quote…"
                    : `${pureBridge ? "Bridge" : cross ? (crossBuy ? "Bridge & swap" : "Swap & bridge") : "Swap"} ${amountText(value)} ${sell.symbol} → ${buy.symbol}${direct ? (side === "buy" ? ` · ${remoteChainName} → ${chain.name}` : ` · ${chain.name} → ${remoteChainName}`) : ""}`
                  : "Enter an amount"}
        </button>
      )}
    </div>
  );
}
