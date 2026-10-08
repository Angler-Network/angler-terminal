"use client";

import { ArrowDown, ChevronDown, Settings2, Shield, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { TERMINAL_PATHS } from "@/lib/terminal-kind";
import { fundsRoute, stepsError } from "@/lib/venues/bridge-routes";
import { readUsdcBalance } from "@/lib/venues/deposit-client";
import { ARBITRUM, BASE, HL_WITHDRAW_FEE_USDC, ROBINHOOD, usdcUnits, type SourceChain } from "@/lib/venues/deposits";
import { LIFI_NATIVE_SOL, LIFI_SOLANA_CHAIN } from "@/lib/venues/lifi";
import type { BridgeLegRef } from "@/lib/venues/bridge-leg";
import { venueAvailable } from "@/lib/deployment";
import { formatPrice } from "@/lib/format";
import { normalizeSpotSymbol } from "@/lib/spot/listings";
import { estimateReceive, routeText, shareOf, swapSizeUsd } from "@/lib/trading/swap";
import { SLIPPAGE_PRESETS_BPS, bpsToPercent, percentToBps, slippageWarning } from "@/lib/trading/slippage";
import { ARCUS_SLIPPAGE_BPS } from "@/lib/venues/arcus/config";
import { arcusQuoteToken, call } from "@/lib/venues/arcus/catalog";
import { ARCUS_MIN_NOTIONAL_USD, arcusConfig } from "@/lib/venues/arcus/config";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";
import { ROBINHOOD_SOURCE_NAMES, robinhoodSources, type RobinhoodSource } from "@/lib/venues/robinhood-sources";
import { fromBaseUnits, toBaseUnits } from "@/lib/venues/jupiter/amounts";
import { spendableBalance } from "@/lib/venues/jupiter/balances";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import { USDC_MINT, WSOL_MINT } from "@/lib/venues/jupiter/config";
import { useSpotHoldings } from "@/components/portfolio/use-spot-holdings";
import type { OrderSide, SpotToken } from "@/lib/venues/types";
import { useAssetSearch, type TokenChoice } from "./asset-search";
import { Picker, type PickerOption } from "./inline-picker";
import { useSelectedAsset } from "./selected-asset";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useSolanaBalance } from "./use-solana-balance";
import { CoinIcon } from "./token-icon";
import { useTrading } from "./trading-provider";
import { continueLabel, errorMessage, stepLabel, units6, useFundsRun } from "./use-funds-run";
import { useNewsTrader } from "./use-news-trader";
import { useRobinhoodQuotes, useSpotQuotes, type SpotSource, type SpotSourceQuote } from "./use-spot-quotes";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

/** A spot venue that lists the chart's asset: Solana through the aggregators (Jupiter, Titan), or Arcus on Robinhood. */
export type SpotChoice =
  | { id: "solana"; name: string; network: string; kind: "spot"; token: SpotToken }
  | { id: "arcus"; name: string; network: string; kind: "spot"; arcusToken: ArcusToken };

const ARM_MS = 5_000;
const BALANCE_REFRESH_MS = 15_000;
const SHARES = [25, 50, 75, 100];
const SOURCE_NAMES: Record<SpotSource, string> = { jupiter: "Jupiter", titan: "Titan", ...ROBINHOOD_SOURCE_NAMES };
/** Logos in the route list (site icons through /api/favicon). */
const SOURCE_DOMAINS: Record<SpotSource, string> = { jupiter: "jup.ag", titan: "titan.exchange", arcus: "arcus.xyz", uniswap: "uniswap.org" };
const OTHER_TOKEN = "__other";
const QUOTE_DEBOUNCE_MS = 600;
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const TOKEN_LIST = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet";
/** What a Solana swap can be paid with (or paid out in on a sell) besides the wallet's other priced tokens. */
const COMMON_PAY = [
  { mint: USDC_MINT, symbol: "USDC", name: "USD Coin", icon: undefined },
  { mint: WSOL_MINT, symbol: "SOL", name: "Solana", icon: `${TOKEN_LIST}/${WSOL_MINT}/logo.png` },
  { mint: USDT_MINT, symbol: "USDT", name: "Tether USD", icon: `${TOKEN_LIST}/${USDT_MINT}/logo.svg` },
];
const DOLLARS = new Set([USDC_MINT, USDT_MINT]);
/** SOL left in the wallet for network fees when "Max" spends SOL. */
const SOL_FEE_RESERVE = 0.01;

/** The Jupiter token for the "Pay with" mint (USDC until something else is picked). */
function usePayToken(mint: string | null) {
  const [state, setState] = useState<{ mint: string; token: SpotToken } | null>(null);
  useEffect(() => {
    if (!mint) return;
    let active = true;
    jupiterVenue
      .quoteToken(mint)
      .then((token) => active && setState({ mint, token }))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mint]);
  return mint && state?.mint === mint ? state.token : null;
}

/**
 * Where an Arcus buy is paid from: USDG already on Robinhood, USDC elsewhere that is bridged in first, or USDC / SOL
 * on Solana, crossed to USDG on Robinhood by LI.FI in one Solana signature.
 */
type PayFrom = "direct" | "arbitrum" | "base" | "hyperliquid" | "solanaUsdc" | "solanaSol";
/** Solana's sample address: LI.FI quotes before a Solana wallet connects. */
const QUOTE_ONLY_SOLANA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const QUOTE_ONLY_EVM = "0x000000000000000000000000000000000000dEaD";
const SOLANA_FILL_POLL_MS = 3_000;
const SOLANA_FILL_TIMEOUT_MS = 10 * 60_000;

/** The wallet's USDC on one chain (cross-chain payment), refreshed while the tab is visible. */
export function useUsdcBalance(source: SourceChain | null, owner: `0x${string}` | null, refresh: number) {
  const key = source && owner ? `${source.chainId}:${owner}:${refresh}` : null;
  const [state, setState] = useState<{ key: string; amount: number } | null>(null);
  useEffect(() => {
    if (!key || !source || !owner) return;
    let active = true;
    const load = () =>
      readUsdcBalance(source, owner)
        .then((units) => active && setState({ key, amount: units6(units) }))
        .catch(() => {});
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers the chain, wallet and refreshes
  }, [key]);
  return key && state?.key === key ? state.amount : null;
}

/** The wallet's stablecoin and asset balances on the choice's chain, refreshed while the tab is visible. */
function useSwapBalances(choice: SpotChoice, owner: string | null, refresh: number, payMint: string = USDC_MINT) {
  const assetId = choice.id === "solana" ? choice.token.mint : choice.arcusToken.address;
  const key = `${choice.id}:${assetId}:${owner}:${refresh}:${payMint}`;
  const [state, setState] = useState<{ key: string; stable: number; asset: number } | null>(null);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    const load = async () => {
      try {
        if (choice.id === "solana") {
          const pay = await jupiterVenue.quoteToken(payMint);
          const held = await jupiterVenue.getBalances(owner, [pay.mint, choice.token.mint]);
          const stable = fromBaseUnits(spendableBalance(pay.mint, held.tokens, held.lamports), pay.decimals);
          const asset = fromBaseUnits(spendableBalance(choice.token.mint, held.tokens, held.lamports), choice.token.decimals);
          if (active) setState({ key, stable, asset });
        } else {
          const [stableToken, { getArcusBalances }] = await Promise.all([arcusQuoteToken(), import("@/lib/venues/arcus/venue")]);
          const held = await getArcusBalances(owner as `0x${string}`, [stableToken, choice.arcusToken]);
          const stable = fromBaseUnits(held[stableToken.address] ?? 0n, stableToken.decimals);
          const asset = fromBaseUnits(held[choice.arcusToken.address] ?? 0n, choice.arcusToken.decimals);
          if (active) setState({ key, stable, asset });
        }
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // The key covers the choice, the wallet and manual refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return owner && state?.key === key ? state : null;
}

/** Arcus's indicative price for a stock token in USDG (what $100 buys), refreshed every few seconds. */
function useArcusPrice(token: ArcusToken | null) {
  const [state, setState] = useState<{ address: string; price?: number; error?: string } | null>(null);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = async () => {
      try {
        const stable = await arcusQuoteToken();
        const spend = 100;
        const body = await call<{ all?: Array<{ venue: string; buyAmount: string }> }>(
          `price?${new URLSearchParams({
            chainId: String(arcusConfig.chainId),
            sellToken: stable.address,
            buyToken: token.address,
            sellAmount: String(spend * 10 ** stable.decimals),
          })}`,
        );
        const entry = body.all?.find((row) => row.venue === "arcus");
        const bought = entry ? fromBaseUnits(BigInt(entry.buyAmount), token.decimals) : 0;
        if (active) setState(bought > 0 ? { address: token.address, price: spend / bought } : { address: token.address, error: `Arcus has no quote for ${token.symbol} right now.` });
      } catch (caught) {
        // NO_QUOTES and friends arrive as readable VenueErrors (`arcusErrorMessage`).
        if (active) setState({ address: token.address, error: caught instanceof Error ? caught.message : String(caught) });
      }
    };
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token]);
  return token && state?.address === token.address ? state : null;
}

/**
 * The swap's route, always on screen when more than one source can fill it: one row per source (logo, name, "Best" next
 * to the best quote). With nothing pinned the best quote is used (Arcus within 0.5% when Arcus is preferred); pressing a
 * row pins it, pressing it again unpins. Rows can be pinned before an amount is typed.
 */
function SpotRoutes({
  sources,
  quotes,
  loading,
  pick,
  onPick,
  preferArcus,
}: {
  sources: SpotSource[];
  quotes: SpotSourceQuote[];
  loading: boolean;
  pick: SpotSource | null;
  onPick: (source: SpotSource | null) => void;
  preferArcus?: { on: boolean; set: (on: boolean) => void };
}) {
  // Quoted sources in quote order (best first), then any the quotes don't cover yet.
  const rows = [...quotes.filter((quote) => sources.includes(quote.source)), ...sources.filter((source) => !quotes.some((quote) => quote.source === source)).map((source) => ({ source, outAmount: null, note: null }) as SpotSourceQuote)];
  const outs = rows.flatMap((quote) => (quote.outAmount !== null ? [quote.outAmount] : []));
  const best = outs.length ? outs.reduce((max, out) => (out > max ? out : max)) : null;
  const auto = rows.find((quote) => quote.outAmount !== null)?.source ?? null;
  return (
    <div className="overflow-hidden rounded-xl border border-app-hairline">
      <div className="flex items-center gap-2 border-b border-app-hairline bg-app-chip/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.06em] text-app-faint">
        <span>Route</span>
        {loading && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-app-accent" />}
      </div>
      {rows.map((quote) => {
        const amount = quote.outAmount !== null && quote.outputToken ? fromBaseUnits(quote.outAmount, quote.outputToken.decimals) : null;
        const gap = quote.outAmount !== null && best !== null && best > 0n && quote.outAmount < best ? (Number(best - quote.outAmount) / Number(best)) * 100 : 0;
        const used = (pick ?? auto) === quote.source;
        return (
          <button
            key={quote.source}
            type="button"
            onClick={() => onPick(pick === quote.source ? null : quote.source)}
            title={quote.note ?? (pick === quote.source ? "Pinned: press again for the best price" : "Swap on this route")}
            className={`flex h-8 w-full items-center gap-2 border-t border-app-hairline px-2.5 text-left text-[12px] transition-colors first:border-t-0 ${used ? "bg-app-accent/10" : "hover:bg-app-chip/60"}`}
          >
            <img
              src={`/api/favicon?domain=${SOURCE_DOMAINS[quote.source]}`}
              alt=""
              width={16}
              height={16}
              className={`size-4 shrink-0 rounded ${used ? "ring-1 ring-app-accent ring-offset-1 ring-offset-app-card" : ""}`}
            />
            <span className={`shrink-0 font-semibold ${quote.outAmount === null ? "text-app-muted" : "text-app-ink"}`}>{SOURCE_NAMES[quote.source]}</span>
            {quote.outAmount !== null && quote.outAmount === best && (
              <span className="rounded bg-app-up/15 px-1 text-[9px] font-bold uppercase tracking-[0.06em] text-app-up">Best</span>
            )}
            {routeText(quote.route) && <span className="min-w-0 truncate text-[10px] text-app-faint" title={`via ${routeText(quote.route)}`}>via {routeText(quote.route)}</span>}
            <span className="ml-auto min-w-0 truncate text-right tabular-nums">
              {amount !== null ? (
                <span className="text-app-ink">
                  {amount.toLocaleString("en-US", { maximumSignificantDigits: 6 })} {quote.outputToken?.symbol}
                </span>
              ) : (
                <span className="text-[11px] text-app-faint">{quote.note ?? "Enter an amount"}</span>
              )}
            </span>
            {gap > 0 && <span className="shrink-0 text-[11px] tabular-nums text-app-down">-{gap.toFixed(2)}%</span>}
          </button>
        );
      })}
      {preferArcus && pick === null && (
        <label className="flex cursor-pointer items-center gap-2 border-t border-app-hairline px-2.5 py-1.5 text-[11px] text-app-muted">
          <input type="checkbox" checked={preferArcus.on} onChange={(event) => preferArcus.set(event.target.checked)} className="size-3.5 accent-[rgb(var(--app-accent))]" />
          Prefer Arcus (Arcus points) unless Uniswap pays over 0.5% more
        </label>
      )}
    </div>
  );
}

/** Long amounts shrink so the token pill keeps its place in the narrow trading column. */
export const amountSize = (text: string) => (text.length > 9 ? "text-[16px]" : text.length > 6 ? "text-[19px]" : "text-[22px]");
/**
 * The "Private" switch in the swap cards' header (`privateSwap`): MEV protection, i.e. only routes whose swap never
 * waits in a public mempool where bots can front-run or sandwich it. It doesn't hide the wallet or the trade on-chain.
 */
export function PrivateToggle() {
  const { preferences, updatePreference } = usePreferences();
  const on = preferences.privateSwap;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => updatePreference("privateSwap", !on)}
      title={
        on
          ? "Private: MEV-protected routes only. Press to allow every route."
          : "Private swap: use only MEV-protected routes, never the public mempool where bots can front-run or sandwich a swap"
      }
      className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold transition-colors ${on ? "bg-app-up/15 text-app-up" : "text-app-muted hover:text-app-ink"}`}
    >
      {on ? <ShieldCheck className="size-4" aria-hidden /> : <Shield className="size-4" aria-hidden />}
      Private
    </button>
  );
}

/** What Private does on this card, shown while it's on. */
export function PrivateNote({ routes }: { routes: string }) {
  const { preferences } = usePreferences();
  if (!preferences.privateSwap) return null;
  return (
    <p className="rounded-lg bg-app-up/10 px-2.5 py-1.5 text-[11px] leading-snug text-app-muted">
      <span className="font-semibold text-app-up">Private swap.</span> Only MEV-protected routes: {routes}. Bots can&apos;t front-run or sandwich it; your
      wallet and the trade are still public on-chain.
    </p>
  );
}

/** Max slippage: Auto (each venue's own estimate) or a fixed percentage, saved as the `swapSlippageBps` preference. */
export function SlippageSettings() {
  const { preferences, updatePreference } = usePreferences();
  const current = preferences.swapSlippageBps;
  const [custom, setCustom] = useState(current !== null && !SLIPPAGE_PRESETS_BPS.includes(current) ? String(current / 100) : "");
  const chip = (active: boolean) =>
    `h-7 rounded-lg px-2.5 text-[12px] font-semibold ${active ? "bg-app-accent text-app-on-accent" : "bg-app-chip text-app-muted hover:text-app-ink"}`;
  const warning = slippageWarning(current);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-app-hairline bg-app-chip/30 p-2.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-semibold text-app-ink">Max slippage</span>
        <span className="text-app-faint">{current === null ? "Auto: estimated per swap" : `Fixed ${bpsToPercent(current)}`}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => (setCustom(""), updatePreference("swapSlippageBps", null))} className={chip(current === null)}>
          Auto
        </button>
        {SLIPPAGE_PRESETS_BPS.map((bps) => (
          <button key={bps} type="button" onClick={() => (setCustom(""), updatePreference("swapSlippageBps", bps))} className={chip(current === bps)}>
            {bpsToPercent(bps)}
          </button>
        ))}
        <label className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[12px] ${custom ? "border-app-accent" : "border-app-hairline-strong"}`}>
          <input
            aria-label="Custom slippage in percent"
            inputMode="decimal"
            placeholder="Custom"
            value={custom}
            onChange={(event) => {
              const text = event.target.value.replace(/[^0-9.]/g, "");
              setCustom(text);
              const bps = percentToBps(text);
              if (bps !== null) updatePreference("swapSlippageBps", bps);
            }}
            className="w-14 bg-transparent text-right tabular-nums text-app-ink outline-hidden placeholder:text-app-faint"
          />
          <span className="text-app-muted">%</span>
        </label>
      </div>
      {warning && <p className="text-[11px] text-[#f5c97b]">{warning}</p>}
    </div>
  );
}

export function DetailRow({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "warn" | "muted" }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="text-app-muted">{label}</span>
      <span className={`truncate text-right tabular-nums ${tone === "warn" ? "text-app-down" : tone === "muted" ? "text-app-faint" : "text-app-ink"}`}>{children}</span>
    </div>
  );
}

export const amountText = (value: number) => value.toLocaleString("en-US", { maximumSignificantDigits: value < 1 ? 4 : 6 });
export const pillClass = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-app-chip pl-1.5 pr-2.5 text-[14px] font-semibold text-app-ink";

/**
 * Spot is a swap: "Sell [amount] [token] → Buy [token]" like the venues' own swap screens. The asset side lists every
 * spot venue that has the chart's asset (a Solana token through Jupiter/Titan, an Arcus stock token on Robinhood
 * Chain) plus a way to pick another token; the stablecoin side is the venue's (USDC on Solana, USDG on Robinhood).
 * The arrow flips the direction. Execution is the same as news trades (`use-news-trader.ts`, sized in USD), behind a
 * confirm press unless one-click is on.
 */
export function SwapCard({ choices }: { choices: SpotChoice[] }) {
  const { symbol, mint: pickedMint, spotVenue, setSwapVenue } = useSelectedAsset();
  const { preferences, updatePreference } = usePreferences();
  const { address: evmAddress, wallet: evmWallet } = useWallet();
  const { address: solanaAddress, signTransaction: signSolana } = useSolanaWallet();
  const { open: openWallets } = useWalletModal();
  const { open: openSearch, pickToken } = useAssetSearch();
  const trade = useNewsTrader();
  const [venueId, setVenueId] = useState<SpotChoice["id"] | null>(null);
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [pick, setPick] = useState<SpotSource | null>(null);
  const [armed, setArmed] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // Buying an unverified token (most fresh pump.fun launches) needs this tick, per token.
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const slippageBps = preferences.swapSlippageBps;
  const toast = useToast();
  const router = useRouter();
  const { network: hlNetwork, accounts } = useTrading();
  const [payFrom, setPayFrom] = useState<PayFrom>("direct");
  // USDG that a cross-chain run delivered to the wallet on Robinhood, waiting for the swap press.
  const [bridged, setBridged] = useState<bigint | null>(null);
  const [crossQuote, setCrossQuote] = useState<{ key: string; out?: bigint; feeUsd?: number; error?: string } | null>(null);
  // Paying from Solana: LI.FI's quote (USDG out) and, once sent, the route being followed until the USDG lands.
  const [solQuote, setSolQuote] = useState<{ key: string; out?: bigint; feeUsd?: number; name?: string; error?: string } | null>(null);
  const [solPending, setSolPending] = useState<{ ref: BridgeLegRef; before: bigint; since: number; explorerUrl: string } | null>(null);
  const { run, setRun, execute } = useFundsRun({
    resume: () => router.push(choices[0]?.id === "arcus" ? TERMINAL_PATHS.book : TERMINAL_PATHS.spot),
    onDone: (carry) => {
      setBridged(carry);
      toast({
        tone: "info",
        title: `${units6(carry).toFixed(2)} ${arcusConfig.quoteSymbol} arrived on Robinhood Chain`,
        message: "Press Swap to finish the buy.",
        action: { label: "Open", onClick: () => router.push(choices[0]?.id === "arcus" ? TERMINAL_PATHS.book : TERMINAL_PATHS.spot) },
        durationMs: 15_000,
      });
    },
  });

  // The venue the pick came from: an Arcus row opens Arcus, a Solana mint opens Solana (else the last one chosen here).
  useEffect(() => {
    if (spotVenue === "arcus") setVenueId("arcus");
    else if (pickedMint) setVenueId("solana");
  }, [symbol, pickedMint, spotVenue]);
  const choice = choices.find((entry) => entry.id === venueId) ?? choices[0];
  // The account card shows this venue's balances only.
  useEffect(() => {
    setSwapVenue(choice.id);
    return () => setSwapVenue(null);
  }, [choice.id, setSwapVenue]);
  const isSolana = choice.id === "solana";
  const owner = isSolana ? solanaAddress : evmAddress;
  const asset = isSolana
    ? { symbol: choice.token.symbol, icon: choice.token.icon, chain: "solana" as const, chainName: "Solana", kind: undefined }
    : { symbol: choice.arcusToken.symbol, icon: undefined, chain: arcusConfig.chainId, chainName: "Robinhood", kind: "stock" as const };
  // Solana swaps pay with (or pay out in) any token: USDC by default, SOL, USDT or another priced token in the wallet.
  const [picked, setPicked] = useState<TokenChoice | null>(null);
  const payMint = isSolana && picked && picked.mint !== choice.token.mint ? picked.mint : USDC_MINT;
  const solanaPay = usePayToken(isSolana ? payMint : null);
  const payIsDollar = !isSolana || DOLLARS.has(payMint);
  const sellIsSol = isSolana && (side === "buy" ? payMint === WSOL_MINT : choice.token.mint === WSOL_MINT);
  const payPrice = !isSolana || payMint === USDC_MINT ? 1 : solanaPay?.usdPrice;
  const stable = isSolana
    ? { symbol: solanaPay?.symbol ?? (payMint === picked?.mint ? picked.symbol : "USDC"), icon: payMint === USDC_MINT ? undefined : (solanaPay?.icon ?? picked?.icon), chain: "solana" as const, chainName: "Solana" }
    : { symbol: arcusConfig.quoteSymbol, icon: undefined, chain: arcusConfig.chainId, chainName: "Robinhood" };
  const holdings = useSpotHoldings();
  const arcusQuote = useArcusPrice(isSolana ? null : choice.arcusToken);
  const arcusPrice = arcusQuote?.price;
  const price = isSolana ? choice.token.usdPrice : arcusPrice;
  const balances = useSwapBalances(choice, owner, refresh, payMint);

  const value = Number(amount);
  // Buying an Arcus stock with dollars held elsewhere: bridge to USDG on Robinhood first (`bridge-routes.ts`), then swap.
  const crossAllowed = !isSolana && side === "buy" && arcusConfig.network === "mainnet";
  const solPay = crossAllowed && (payFrom === "solanaUsdc" || payFrom === "solanaSol");
  const cross = crossAllowed && payFrom !== "direct" && !solPay;
  const crossRoute = cross
    ? fundsRoute(payFrom === "hyperliquid" ? "hyperliquid" : "wallet", "wallet", { from: payFrom === "base" ? "base" : "arbitrum", to: "robinhood" }, () => hlNetwork)
    : null;
  const crossSteps = crossRoute?.kind === "steps" ? crossRoute.steps : [];
  const paySource = payFrom === "base" ? BASE : ARBITRUM;
  const payWallet = useUsdcBalance(cross && payFrom !== "hyperliquid" ? paySource : null, evmAddress, refresh);
  const payBalance = payFrom === "hyperliquid" ? (accounts.hyperliquid?.withdrawable ?? null) : payWallet;
  const crossBusy = run !== null && run.phase !== "done";
  const locked = crossBusy || bridged !== null || solPending !== null;
  const units = usdcUnits(amount);
  const solMint = payFrom === "solanaSol" ? WSOL_MINT : USDC_MINT;
  const solDecimals = payFrom === "solanaSol" ? 9 : 6;
  const solBalanceUnits = useSolanaBalance(solPay ? solanaAddress : null, solPay ? solMint : null, refresh);
  const solBalance = solBalanceUnits === undefined ? null : fromBaseUnits(solBalanceUnits, solDecimals);
  let solUnits: bigint | null = null;
  try {
    solUnits = solPay && Number(amount) > 0 ? toBaseUnits(amount, solDecimals) : null;
  } catch {}
  const solKey = solPay && solUnits && solUnits > 0n ? `${payFrom}:${solUnits}:${solanaAddress ?? ""}:${evmAddress ?? ""}` : null;
  const solLine = solQuote && solQuote.key === solKey ? solQuote : null;
  const solOut = solLine?.out !== undefined ? units6(solLine.out) : null;
  const acrossIndex = crossSteps.findIndex((step) => step.kind === "across");
  const acrossStep = acrossIndex >= 0 ? (crossSteps[acrossIndex] as Extract<(typeof crossSteps)[number], { kind: "across" }>) : null;
  const acrossInput = acrossStep && units !== null ? (acrossIndex === 0 ? units : usdcUnits(String(Math.floor((value - HL_WITHDRAW_FEE_USDC) * 1e6) / 1e6))) : null;
  const crossKey = acrossStep && acrossInput && acrossInput > 0n && evmAddress ? `${acrossStep.from.chainId}:${acrossInput}:${evmAddress}` : null;
  const crossLine = crossQuote && crossQuote.key === crossKey ? crossQuote : null;
  const crossOut = crossLine?.out !== undefined ? units6(crossLine.out) : null;
  const sizeUsd = solPay ? (solOut ?? 0) : cross ? (crossOut ?? 0) : side === "buy" ? (value > 0 && payPrice ? value * payPrice : 0) : swapSizeUsd("sell", value, price);
  const { quotes, loading } = useSpotQuotes({
    token: isSolana ? choice.token : null,
    side,
    sizeUsd,
    taker: solanaAddress,
    // Private swaps land through Jupiter (Beam) only: Titan's transaction would go out through a public RPC.
    titan: preferences.venueTitan && venueAvailable("titan") && !preferences.privateSwap,
    slippageBps,
    quoteMint: payMint === USDC_MINT ? undefined : payMint,
  });
  // Robinhood Chain stock tokens: Arcus and Uniswap quote the same swap once Uniswap is on (Arcus alone keeps its own flow).
  const rhSources = isSolana ? [] : robinhoodSources(preferences);
  const compareRh = !isSolana && !cross && !solPay && rhSources.includes("uniswap");
  const rh = useRobinhoodQuotes({
    token: compareRh && !isSolana ? choice.arcusToken : null,
    side,
    sizeUsd,
    taker: evmAddress,
    sources: rhSources,
    slippageBps,
    preferArcus: preferences.preferArcus,
  });
  const routeQuotes = isSolana ? quotes : rh.quotes;
  const routesLoading = isSolana ? loading : rh.loading;
  const hasQuotes = isSolana || compareRh;
  const routeSources: SpotSource[] = isSolana ? ["jupiter", ...(preferences.venueTitan && venueAvailable("titan") && !preferences.privateSwap ? (["titan"] as const) : [])] : compareRh ? rhSources : [];
  const selected = pick ? routeQuotes.find((quote) => quote.source === pick) : routeQuotes.find((quote) => quote.outAmount !== null);
  // The Robinhood source the swap goes to: the pinned or best quote, else the first enabled one.
  const rhSource = isSolana ? null : ((selected?.source as RobinhoodSource | undefined) ?? rhSources[0] ?? "arcus");
  const quoted = selected?.outAmount != null && selected.outputToken ? fromBaseUnits(selected.outAmount, selected.outputToken.decimals) : null;
  // Before a quote lands: the USD size at the asset's price (buys) or the pay token's (sells).
  const estimated = side === "buy" ? estimateReceive("buy", sizeUsd, price) : payPrice ? sizeUsd / payPrice : null;
  const receive = sizeUsd > 0 ? (cross || solPay ? estimateReceive("buy", sizeUsd, price) : (quoted ?? estimated)) : null;
  const payToken = solPay
    ? { symbol: payFrom === "solanaSol" ? "SOL" : "USDC", chain: "solana" as const, chainName: "Solana" }
    : {
        symbol: "USDC",
        chain: payFrom === "hyperliquid" ? ("hyperliquid" as const) : paySource.chainId,
        chainName: payFrom === "hyperliquid" ? "Hyperliquid" : paySource.name,
      };
  const sell = cross || solPay ? payToken : side === "buy" ? stable : asset;
  const buy = side === "buy" ? asset : stable;
  const sellBalance = solPay ? solBalance : cross ? payBalance : balances ? (side === "buy" ? balances.stable : balances.asset) : null;
  const receiveUsd = receive === null ? null : side === "buy" ? (solPay ? solOut : cross ? crossOut : price ? receive * price : null) : payPrice ? receive * payPrice : null;
  // What one asset token costs in this swap (the quote's own rate once it's in).
  const rate = receive && value > 0 ? (side === "buy" ? value / receive : receive / value) : price;
  // Arcus alone (no Uniswap to compare, e.g. testnet) and it has no quote: say so before any amount is typed.
  const arcusUnavailable = !isSolana && !compareRh && rhSource === "arcus" && !arcusPrice && arcusQuote?.error ? arcusQuote.error : null;
  const error = arcusUnavailable
    ? arcusUnavailable
    : !(value > 0)
    ? null
    : solPay && solLine?.error
      ? solLine.error
    : cross && crossRoute?.kind !== "steps"
      ? "This payment route isn't available right now."
      : cross && stepsError(crossSteps, value, payFrom === "hyperliquid" ? (payBalance ?? undefined) : undefined, "USDC")
        ? stepsError(crossSteps, value, payFrom === "hyperliquid" ? (payBalance ?? undefined) : undefined, "USDC")
        : cross && crossLine?.error
          ? crossLine.error
          : sellBalance !== null && value > sellBalance + 1e-9
      ? `Not enough ${sell.symbol} on ${sell.chainName}.`
      : side === "sell" && !price
        ? `No ${asset.symbol} price yet.`
        : !isSolana && rhSource === "arcus" && sizeUsd < ARCUS_MIN_NOTIONAL_USD
          ? `Arcus needs at least $${ARCUS_MIN_NOTIONAL_USD} per swap.`
          : null;
  const unverified = isSolana && !choice.token.isVerified ? choice.token : null;
  const needsAck = unverified !== null && side === "buy" && acknowledged !== unverified.mint;
  const viaRoute = hasQuotes ? routeText(selected?.route) : null;
  // Paying from Solana needs both wallets: Solana signs, the EVM wallet receives the USDG and signs the Arcus swap.
  const needsSolana = solPay && !solanaAddress;
  const canSwap = Boolean(owner) && !needsSolana && sizeUsd > 0 && !error && !isPlacing && !locked && !needsAck;

  // Debounced bridge quote (Across, Relay or LI.FI, the best one) for a cross-chain payment: what USDG lands on Robinhood for this USDC.
  useEffect(() => {
    if (!crossKey || !acrossStep || !acrossInput || !evmAddress || locked) return setCrossQuote(null);
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const { quoteBridgeLeg, noRouteReason } = await import("@/lib/venues/bridge-leg");
        const result = await quoteBridgeLeg({ from: acrossStep.from, to: acrossStep.to, units: acrossInput, depositor: evmAddress, recipient: evmAddress });
        const quote = result.best;
        if (active) setCrossQuote(quote ? { key: crossKey, out: quote.expectedOut, feeUsd: quote.feeUsd } : { key: crossKey, error: noRouteReason(result) });
      } catch (caught) {
        if (active) setCrossQuote({ key: crossKey, error: errorMessage(caught) });
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers every input
  }, [crossKey, locked]);

  // Debounced LI.FI quote for paying from Solana: what USDG lands on Robinhood for this USDC or SOL.
  useEffect(() => {
    if (!solKey || !solUnits || locked) return setSolQuote(null);
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const { quoteDirectSwap } = await import("@/lib/venues/bridge-leg");
        const result = await quoteDirectSwap({
          fromChain: LIFI_SOLANA_CHAIN,
          toChain: ROBINHOOD.mainnet.chainId,
          fromToken: payFrom === "solanaSol" ? LIFI_NATIVE_SOL : USDC_MINT,
          toToken: ROBINHOOD.mainnet.usdc,
          amount: solUnits,
          fromAddress: solanaAddress ?? QUOTE_ONLY_SOLANA,
          toAddress: evmAddress ?? QUOTE_ONLY_EVM,
          slippageBps,
        });
        if (!active) return;
        setSolQuote(
          result.best
            ? { key: solKey, out: result.best.raw.expectedOut, feeUsd: result.best.raw.feeUsd, name: result.best.name }
            : { key: solKey, error: result.error ?? "No route from Solana right now." },
        );
      } catch (caught) {
        if (active) setSolQuote({ key: solKey, error: errorMessage(caught) });
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers every input
  }, [solKey, locked]);

  // After the Solana send: follow LI.FI until it fills, then hand the USDG that arrived to the Arcus swap press.
  useEffect(() => {
    if (!solPending || !evmAddress) return;
    const pending = solPending;
    const timer = window.setInterval(async () => {
      const { bridgeLegState } = await import("@/lib/venues/bridge-leg");
      const state = await bridgeLegState(pending.ref, LIFI_SOLANA_CHAIN).catch(() => "pending" as const);
      if (state === "pending" && Date.now() - pending.since < SOLANA_FILL_TIMEOUT_MS) return;
      setSolPending(null);
      setRefresh((count) => count + 1);
      if (state === "filled") {
        const { readUsdcBalance } = await import("@/lib/venues/deposit-client");
        const after = await readUsdcBalance(ROBINHOOD.mainnet, evmAddress).catch(() => null);
        const arrived = after !== null && after > pending.before ? after - pending.before : null;
        if (arrived === null) {
          toast({ tone: "info", title: "USDG arrived on Robinhood Chain", message: "Pick USDG · Robinhood and swap it on Arcus." });
          return;
        }
        setBridged(arrived);
        toast({
          tone: "info",
          title: `${units6(arrived).toFixed(2)} ${arcusConfig.quoteSymbol} arrived on Robinhood Chain`,
          message: "Press Swap to finish the buy.",
          link: { href: pending.explorerUrl, label: "View transaction" },
          durationMs: 15_000,
        });
      } else {
        toast({
          tone: "error",
          title: state === "failed" ? "Refunded on Solana" : "The bridge is taking longer than usual",
          message: state === "failed" ? "LI.FI couldn't fill it and returned the funds to your Solana wallet." : "Check the transaction; LI.FI refunds on Solana if it can't fill.",
          link: { href: pending.explorerUrl, label: "View transaction" },
        });
      }
    }, SOLANA_FILL_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poller per send
  }, [solPending, evmAddress]);

  useEffect(() => setArmed(false), [symbol, choice.id, side, amount, pick, payFrom]);
  // A pinned source belongs to one chain's list.
  useEffect(() => setPick(null), [choice.id]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  useEffect(() => {
    if (!locked) setAmount("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new asset starts over, unless a bridge is under way
  }, [symbol]);

  const flip = () => {
    setSide((current) => (current === "buy" ? "sell" : "buy"));
    // The amount that would have come out goes in, like the venues' own swap screens.
    setAmount(receive && receive > 0 ? String(Number(receive.toPrecision(6))) : "");
  };

  /** The swap after a cross-chain run: the USDG that arrived, rounded down to the cent. */
  const swapBridged = async () => {
    if (bridged === null || choice.id !== "arcus") return;
    setIsPlacing(true);
    try {
      const placed = await trade({
        symbol,
        venue: "spot",
        spotVenue: "arcus",
        side: "buy",
        sizeUsd: Math.floor(units6(bridged) * 100) / 100,
        slippageBps,
        oneClick: preferences.oneClickTrading,
      });
      if (placed) {
        setBridged(null);
        setRun(null);
        setAmount("");
      }
      setRefresh((count) => count + 1);
    } finally {
      setIsPlacing(false);
    }
  };

  const submit = async () => {
    if (!owner || needsSolana) return openWallets();
    if (!canSwap) return;
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setArmed(false);
    if (cross && units !== null) return void execute({ steps: crossSteps, index: 0, phase: "ready", carry: units });
    if (solPay) {
      if (!solUnits || !evmAddress || !evmWallet || !signSolana) return;
      setIsPlacing(true);
      try {
        const [{ quoteDirectSwap, sendDirectSwap }, { readUsdcBalance }] = await Promise.all([import("@/lib/venues/bridge-leg"), import("@/lib/venues/deposit-client")]);
        const before = await readUsdcBalance(ROBINHOOD.mainnet, evmAddress).catch(() => 0n);
        const fresh = await quoteDirectSwap({
          fromChain: LIFI_SOLANA_CHAIN,
          toChain: ROBINHOOD.mainnet.chainId,
          fromToken: payFrom === "solanaSol" ? LIFI_NATIVE_SOL : USDC_MINT,
          toToken: ROBINHOOD.mainnet.usdc,
          amount: solUnits,
          fromAddress: solanaAddress!,
          toAddress: evmAddress,
          slippageBps,
        });
        if (!fresh.best) throw new Error(fresh.error ?? "No route from Solana right now.");
        const sent = await sendDirectSwap(fresh.best, { provider: evmWallet.provider, account: evmAddress, source: null, solana: signSolana, units: solUnits });
        setSolPending({ ref: sent.ref, before, since: Date.now(), explorerUrl: sent.explorerUrl });
      } catch (caught) {
        toast({ tone: "error", title: "Couldn't send from Solana", message: errorMessage(caught) });
      } finally {
        setIsPlacing(false);
      }
      return;
    }
    setIsPlacing(true);
    try {
      const placed = await trade({
        symbol,
        mint: isSolana ? choice.token.mint : undefined,
        spotSource: isSolana ? ((pick as "jupiter" | "titan" | null) ?? "best") : undefined,
        robinhoodSource: !isSolana && pick ? (pick as RobinhoodSource) : undefined,
        quoteMint: isSolana && payMint !== USDC_MINT ? payMint : undefined,
        venue: "spot",
        spotVenue: isSolana ? "jupiter" : "arcus",
        side,
        sizeUsd,
        slippageBps,
        oneClick: preferences.oneClickTrading,
      });
      if (placed) setAmount("");
      setRefresh((count) => count + 1);
    } finally {
      setIsPlacing(false);
    }
  };

  const assetOptions: Array<PickerOption<string>> = [
    ...choices.map((entry) =>
      entry.id === "solana"
        ? { value: entry.id, label: `${entry.token.symbol} · Solana`, icon: <CoinIcon src={entry.token.icon} symbol={entry.token.symbol} chain="solana" size={20} /> }
        : {
            value: entry.id,
            label: `${entry.arcusToken.symbol} · Robinhood`,
            icon: <CoinIcon symbol={entry.arcusToken.symbol} kind="stock" chain={arcusConfig.chainId} size={20} />,
            note: entry.network === "mainnet" ? undefined : entry.network,
          },
    ),
    { value: OTHER_TOKEN, label: "Other token…" },
  ];
  const assetFace = (
    <>
      <CoinIcon src={asset.icon} symbol={asset.symbol} kind={asset.kind} chain={asset.chain} size={24} />
      <span className="flex flex-col items-start leading-tight">
        {asset.symbol}
        <span className="text-[10px] font-medium text-app-muted">{asset.chainName}</span>
      </span>
    </>
  );
  // One venue: the pill opens the token search straight away. Several (NVDA on Solana and Robinhood): a list to pick
  // the venue, with the search at the bottom.
  const assetPill =
    choices.length > 1 ? (
      <Picker
        label="Token"
        value={choice.id}
        options={assetOptions}
        onChange={(next) => (next === OTHER_TOKEN ? openSearch() : setVenueId(next as SpotChoice["id"]))}
        buttonClassName={`${pillClass} hover:bg-app-selected`}
      >
        {assetFace}
      </Picker>
    ) : (
      <button type="button" aria-label="Token" title="Pick another token" onClick={openSearch} className={`${pillClass} hover:bg-app-selected`}>
        {assetFace}
        <ChevronDown className="size-4 text-app-muted" aria-hidden />
      </button>
    );
  const stableFace = (
    <>
      <CoinIcon src={stable.icon} symbol={stable.symbol} chain={stable.chain} size={24} />
      <span className="flex flex-col items-start leading-tight">
        {stable.symbol}
        <span className="text-[10px] font-medium text-app-muted">{stable.chainName}</span>
      </span>
    </>
  );
  // Solana: any token. USDC, SOL, USDT and the wallet's tokens first, then the top pairs and a live search.
  const pinnedPay: TokenChoice[] = [
    ...COMMON_PAY.map((entry) => ({ ...entry, verified: true, source: "Popular" })),
    ...(holdings.data?.holdings ?? [])
      .filter((holding) => !COMMON_PAY.some((entry) => entry.mint === holding.mint))
      .map((holding) => ({ mint: holding.mint, symbol: holding.symbol, icon: holding.icon ?? undefined, price: holding.usdPrice ?? undefined })),
  ];
  const stablePill = isSolana ? (
    <button
      type="button"
      aria-label={side === "buy" ? "Pay with" : "Receive"}
      title="Pick any Solana token"
      onClick={() =>
        pickToken({
          title: side === "buy" ? "Pay with" : "Receive",
          pinned: pinnedPay,
          exclude: choice.token.mint,
          onPick: (token) => {
            setPicked(token);
            setAmount("");
          },
        })
      }
      className={`${pillClass} hover:bg-app-selected`}
    >
      {stableFace}
      <ChevronDown className="size-4 text-app-muted" aria-hidden />
    </button>
  ) : (
    <span className={pillClass} title={`${stable.symbol} on ${stable.chainName}, the dollar this venue trades against`}>
      {stableFace}
    </span>
  );
  const payOptions: Array<PickerOption<PayFrom>> = [
    { value: "direct", label: `${arcusConfig.quoteSymbol} · Robinhood`, icon: <CoinIcon symbol={arcusConfig.quoteSymbol} chain={arcusConfig.chainId} size={20} /> },
    { value: "arbitrum", label: "USDC · Arbitrum", icon: <CoinIcon symbol="USDC" chain={ARBITRUM.chainId} size={20} />, note: "bridge" },
    { value: "base", label: "USDC · Base", icon: <CoinIcon symbol="USDC" chain={BASE.chainId} size={20} />, note: "bridge" },
    { value: "solanaUsdc", label: "USDC · Solana", icon: <CoinIcon symbol="USDC" chain="solana" size={20} />, note: "LI.FI" },
    { value: "solanaSol", label: "SOL · Solana", icon: <CoinIcon symbol="SOL" chain="solana" size={20} />, note: "LI.FI" },
    // Hyperliquid withdrawals only bridge onward from mainnet.
    ...(hlNetwork === "mainnet"
      ? [{ value: "hyperliquid" as const, label: "USDC · Hyperliquid", icon: <CoinIcon symbol="USDC" chain="hyperliquid" size={20} />, note: "bridge" }]
      : []),
  ];
  const payPill = (
    <Picker label="Pay with" value={payFrom} options={payOptions} onChange={setPayFrom} disabled={locked} buttonClassName={`${pillClass} hover:bg-app-selected disabled:opacity-60`}>
      <CoinIcon symbol={sell.symbol} chain={sell.chain} size={24} />
      <span className="flex flex-col items-start leading-tight">
        {sell.symbol}
        <span className="text-[10px] font-medium text-app-muted">{sell.chainName}</span>
      </span>
    </Picker>
  );
  const box = "flex flex-col gap-2 rounded-2xl border border-app-hairline bg-app-chip/30 p-3";
  const walletName = isSolana ? "Solana" : "EVM";

  const quoteOut = selected?.outputToken;
  const minOut = hasQuotes && selected?.minOut !== undefined && quoteOut ? fromBaseUnits(selected.minOut, quoteOut.decimals) : null;
  const impact = hasQuotes && selected?.priceImpactPct !== undefined ? Math.abs(selected.priceImpactPct) : null;
  // Uniswap picks its own slippage under Auto; Arcus signs its default bound.
  const shownSlippage = isSolana ? (selected?.slippageBps ?? slippageBps) : rhSource === "uniswap" ? slippageBps : (slippageBps ?? ARCUS_SLIPPAGE_BPS);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1">
        <span className="mr-auto text-[13px] font-semibold text-app-ink">Swap</span>
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
      <PrivateNote routes={isSolana ? "Jupiter (Beam landing)" : "Arcus (gasless RFQ)"} />
      <div className="relative flex flex-col gap-1">
        <div className={box}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-app-muted">Sell</span>
            {sellBalance !== null && (
              <span className="text-app-faint">
                Balance <span className="font-semibold tabular-nums text-app-ink">{amountText(sellBalance)}</span>
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
            {side === "buy" ? (crossAllowed ? payPill : stablePill) : assetPill}
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="mr-auto tabular-nums text-app-faint">{solPay ? (solOut ? `≈ ${formatPrice(solOut)}` : "$0.00") : cross ? (value > 0 ? `≈ ${formatPrice(value)}` : "$0.00") : sizeUsd > 0 ? `≈ ${formatPrice(sizeUsd)}` : "$0.00"}</span>
            {sellBalance !== null &&
              !locked &&
              SHARES.map((share) => (
                <button
                  key={share}
                  type="button"
                  // Paying with SOL keeps a little back for network fees.
                  onClick={() => setAmount(shareOf(Math.max(0, sellBalance - (sellIsSol ? SOL_FEE_RESERVE : 0)), share, side === "buy" ? 6 : 8))}
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
            {side === "buy" ? assetPill : stablePill}
          </div>
          <span className="text-[12px] tabular-nums text-app-faint">{receiveUsd ? `≈ ${formatPrice(receiveUsd)}` : "$0.00"}</span>
        </div>
      </div>

      {isSolana && normalizeSpotSymbol(choice.token.symbol) !== normalizeSpotSymbol(symbol) && (
        // The asset has no token of its own name on Solana: say which token the swap actually trades.
        <p className="text-[11px] leading-snug text-app-faint">
          Trades <span className="font-semibold text-app-muted">{choice.token.symbol}</span> ({choice.token.name}), the most traded {symbol} on Solana right now.
        </p>
      )}
      {solPay && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-app-hairline p-2.5">
          <p className="text-[12px] text-app-ink">
            Your {payToken.symbol} on Solana is crossed to {arcusConfig.quoteSymbol} on Robinhood Chain (sent to your EVM wallet), then swapped for {asset.symbol} on
            Arcus. Both wallets are needed.
            {solLine?.feeUsd !== undefined && <span className="text-app-muted"> Route fee {solLine.feeUsd < 0.01 ? "< $0.01" : `$${solLine.feeUsd.toFixed(2)}`}.</span>}
          </p>
          <ol className="flex flex-col gap-1">
            {[
              `${solLine?.name ?? "LI.FI"}: ${payToken.symbol} on Solana → ${arcusConfig.quoteSymbol} on Robinhood (one Solana signature, seconds to minutes)`,
              `Swap ${arcusConfig.quoteSymbol} → ${asset.symbol} on Arcus (signature, gasless)`,
            ].map((label, index) => {
              const at = bridged !== null ? 1 : solPending ? 0 : -1;
              const done = index < at;
              const current = index === at;
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
          {solPending && <p className="text-[11px] text-app-muted">The bridge is filling on Robinhood Chain… You can keep trading; we&apos;ll tell you when it&apos;s there.</p>}
        </div>
      )}
      {cross && crossSteps.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-app-hairline p-2.5">
          <p className="text-[12px] text-app-ink">
            Your USDC is bridged to Robinhood Chain and converted to {arcusConfig.quoteSymbol} (Paxos&apos;s dollar, about 1:1), then swapped for{" "}
            {asset.symbol} on {rhSources.includes("uniswap") ? "Arcus or Uniswap, whichever pays more" : "Arcus"}.
            {crossLine?.feeUsd !== undefined && <span className="text-app-muted"> Bridge fee {crossLine.feeUsd < 0.01 ? "< $0.01" : `$${crossLine.feeUsd.toFixed(2)}`}.</span>}
          </p>
          <ol className="flex flex-col gap-1">
            {[...crossSteps.map(stepLabel), rhSources.includes("uniswap") ? `Swap ${arcusConfig.quoteSymbol} → ${asset.symbol} at the best price (Arcus or Uniswap)` : `Swap ${arcusConfig.quoteSymbol} → ${asset.symbol} on Arcus (signature, gasless)`].map((label, index) => {
              const at = bridged !== null ? crossSteps.length : run ? run.index : -1;
              const done = index < at;
              const current = index === at;
              return (
                <li key={index} className={`flex items-start gap-2 text-[11px] ${current ? "font-semibold text-app-ink" : done ? "text-app-up" : "text-app-faint"}`}>
                  <span
                    className={`mt-px grid size-4 shrink-0 place-items-center rounded-full text-[10px] ${done ? "bg-app-up text-black" : current ? "bg-app-accent text-app-on-accent" : "bg-app-chip"}`}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>
          {run?.phase === "waiting" && (
            <p className="text-[11px] text-app-muted">
              {run.wait?.kind === "arrival" ? "Waiting for the USDC to land on Arbitrum…" : `The bridge is filling on ${run.wait?.to.name}…`} You can keep trading; we&apos;ll tell
              you when it&apos;s there.
            </p>
          )}
        </div>
      )}
      {rate && (
        <p className="text-[12px] tabular-nums text-app-muted">
          1 {asset.symbol} ≈ {payIsDollar ? formatPrice(rate) : amountText(rate)} {stable.symbol}
          <span className="text-app-faint">
            {" · "}
            {isSolana
              ? viaRoute
                ? `via ${viaRoute}`
                : "Jupiter / Titan, best route"
              : rhSource === "uniswap"
                ? `Uniswap on Robinhood Chain${selected?.gasFeeUsd === 0 ? ", gasless" : viaRoute ? ` via ${viaRoute}` : ""}`
                : `Arcus on Robinhood Chain${arcusConfig.network === "mainnet" ? "" : ` ${arcusConfig.network}`}, gasless`}
          </span>
        </p>
      )}
      {unverified && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-app-down/40 bg-app-down/10 p-2.5 text-[12px] text-app-ink">
          <p>
            <span className="font-semibold text-app-down">Unverified token</span>
            {unverified.launchpad && <span className="text-app-muted"> · launched on {unverified.launchpad}</span>}. Anyone can create a token with any
            name and logo. Check the address before buying:{" "}
            <a href={`https://solscan.io/token/${unverified.mint}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] underline">
              {unverified.mint.slice(0, 4)}…{unverified.mint.slice(-4)}
            </a>
          </p>
          {side === "buy" && (
            <label className="flex items-center gap-2 text-app-muted">
              <input
                type="checkbox"
                checked={acknowledged === unverified.mint}
                onChange={(event) => setAcknowledged(event.target.checked ? unverified.mint : null)}
                className="accent-[rgb(var(--app-accent))]"
              />
              I checked this token and want to buy it
            </label>
          )}
        </div>
      )}
      {isSolana && !unverified && choice.token.launchpad && (
        <p className="text-[11px] text-app-faint">Launched on {choice.token.launchpad}.</p>
      )}
      {hasQuotes && routeSources.length > 1 && (
        <SpotRoutes
          sources={routeSources}
          quotes={sizeUsd > 0 ? routeQuotes : []}
          loading={routesLoading}
          pick={pick}
          onPick={setPick}
          preferArcus={!isSolana && venueAvailable("arcus") ? { on: preferences.preferArcus, set: (on) => updatePreference("preferArcus", on) } : undefined}
        />
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
              {amountText(minOut)} {quoteOut?.symbol}
            </DetailRow>
          )}
          {impact !== null && (
            <DetailRow label="Price impact" tone={impact > 1 ? "warn" : undefined}>
              {impact < 0.01 ? "< 0.01%" : `${impact.toFixed(2)}%`}
            </DetailRow>
          )}
          <DetailRow label="Max slippage" tone={slippageBps === null ? "muted" : undefined}>
            {shownSlippage ? `${bpsToPercent(shownSlippage)}${slippageBps === null ? " · auto" : ""}` : "Auto"}
          </DetailRow>
          {hasQuotes && selected?.feeBps !== undefined && <DetailRow label="Platform fee">{bpsToPercent(selected.feeBps)}</DetailRow>}
          {!isSolana && selected?.gasFeeUsd !== undefined && selected.gasFeeUsd !== null && (
            <DetailRow label="Network fee" tone={selected.gasFeeUsd === 0 ? "muted" : undefined}>
              {selected.gasFeeUsd === 0 ? "None (gasless)" : selected.gasFeeUsd < 0.01 ? "< $0.01" : `~$${selected.gasFeeUsd.toFixed(2)}`}
            </DetailRow>
          )}
          {solPay && solLine?.feeUsd !== undefined && <DetailRow label="Route fee">{solLine.feeUsd < 0.01 ? "< $0.01" : `$${solLine.feeUsd.toFixed(2)}`}</DetailRow>}
          {cross && crossLine?.feeUsd !== undefined && <DetailRow label="Bridge fee">{crossLine.feeUsd < 0.01 ? "< $0.01" : `$${crossLine.feeUsd.toFixed(2)}`}</DetailRow>}
        </div>
      )}
      {error && <p className="text-[12px] text-app-down">{error}</p>}

      {solPending ? (
        <button type="button" disabled className="h-11 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent disabled:opacity-50">
          Bridging from Solana…
        </button>
      ) : bridged !== null ? (
        <button type="button" disabled={isPlacing} onClick={() => void swapBridged()} className="h-11 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent disabled:opacity-50">
          {isPlacing ? "Confirm in your wallet…" : `Swap ${units6(bridged).toFixed(2)} ${arcusConfig.quoteSymbol} → ${asset.symbol}`}
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
          className={`h-11 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 ${
            armed ? "bg-app-ink text-app-card" : "bg-app-accent text-app-on-accent hover:opacity-90"
          }`}
        >
          {!owner
            ? `Connect ${walletName} wallet`
            : needsSolana
              ? "Connect Solana wallet"
              : isPlacing
              ? "Confirm in your wallet…"
              : armed
                ? `Confirm: ${amountText(value)} ${sell.symbol} → ${buy.symbol}`
                : value > 0
                  ? `${cross || solPay ? "Bridge & swap" : "Swap"} ${amountText(value)} ${sell.symbol} → ${buy.symbol}`
                  : "Enter an amount"}
        </button>
      )}
    </div>
  );
}
