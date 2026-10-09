"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { trackTrade } from "@/lib/analytics/client";
import type { BridgeLegRef, DirectQuote } from "@/lib/venues/bridge-leg";
import { sourceChainById } from "@/lib/venues/deposits";
import { WSOL_MINT } from "@/lib/venues/jupiter/config";
import { LIFI_NATIVE_SOL, LIFI_SOLANA_CHAIN } from "@/lib/venues/lifi";
import { type EvmSwapChain, isNativeToken, parseEvmRef, evmSwapChain } from "@/lib/venues/uniswap/chains";
import { fromBaseUnits, toBaseUnits } from "@/lib/venues/jupiter/amounts";
import { recordSwap } from "./swap-history-store";
import { errorMessage } from "./use-funds-run";
import type { TokenChoice } from "./asset-search";

const QUOTE_DEBOUNCE_MS = 500;
const FILL_POLL_MS = 3_000;
const FILL_TIMEOUT_MS = 10 * 60_000;
const QUOTE_ONLY_SOLANA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const QUOTE_ONLY_EVM = "0x000000000000000000000000000000000000dEaD";

/** A token on an EVM chain picked as the other side of a Solana swap. */
export interface ForeignToken {
  chain: EvmSwapChain;
  address: `0x${string}`;
  symbol: string;
  icon?: string;
  /** From the pick when it carried them; else read from the contract. */
  decimals?: number;
}

/** The EVM token a picker row stands for (a pinned row with its chain, or a search row's `evm:` ref), else null. */
export function foreignFromChoice(choice: TokenChoice | null): ForeignToken | null {
  if (!choice) return null;
  const ref = parseEvmRef(choice.mint);
  if (ref) return { chain: ref.chain, address: ref.address, symbol: choice.symbol, icon: choice.icon, decimals: choice.decimals };
  const chain = choice.chainId ? evmSwapChain(choice.chainId) : null;
  if (chain && /^0x[0-9a-fA-F]{40}$/.test(choice.mint)) return { chain, address: choice.mint as `0x${string}`, symbol: choice.symbol, icon: choice.icon, decimals: choice.decimals };
  return null;
}

/** The foreign token's decimals and the EVM wallet's balance of it (read from its chain). */
function useForeignToken(token: ForeignToken | null, owner: `0x${string}` | null, refresh: number) {
  const key = token ? `${token.chain.id}:${token.address}:${owner ?? ""}:${refresh}` : null;
  const [state, setState] = useState<{ key: string; decimals: number; balance: bigint | null } | null>(null);
  useEffect(() => {
    if (!key || !token) return;
    let active = true;
    void (async () => {
      try {
        const { createPublicClient, erc20Abi, http } = await import("viem");
        const client = createPublicClient({ transport: http(token.chain.rpc) });
        const native = isNativeToken(token.address);
        const decimals = token.decimals ?? (native ? 18 : await client.readContract({ address: token.address, abi: erc20Abi, functionName: "decimals" }));
        const balance = !owner ? null : native ? await client.getBalance({ address: owner }) : await client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
        if (active) setState({ key, decimals: Number(decimals), balance });
      } catch {
        if (active) setState({ key, decimals: token.decimals ?? 18, balance: null });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers the token, wallet and refreshes
  }, [key]);
  return key && state?.key === key ? state : null;
}

/** LI.FI's address for a Solana mint (native SOL has its own). */
const lifiSolanaToken = (mint: string) => (mint === WSOL_MINT ? LIFI_NATIVE_SOL : mint);

export interface CrossSwapInput {
  /** The Solana token on the card (what's bought, or sold). */
  solana: { mint: string; symbol: string; decimals: number };
  foreign: ForeignToken | null;
  side: "buy" | "sell";
  /** Typed amount: the foreign token (buys) or the Solana token (sells). */
  amount: string;
  evmAddress: `0x${string}` | null;
  solanaAddress: string | null;
  slippageBps: number | null;
  refresh: number;
  /** The Solana token's USD price, for the swap history and analytics. */
  solanaPrice?: number;
}

/**
 * A Solana swap paid with (or paid out in) a token on an EVM chain: one LI.FI route across chains, quoted as the
 * amount is typed. Buying, the EVM wallet sends and the Solana token lands in the Solana wallet; selling, the Solana
 * wallet sends and the EVM token lands in the EVM wallet. Relay doesn't route Solana here, so it's LI.FI.
 */
export function useCrossSwap(input: CrossSwapInput) {
  const toast = useToast();
  const { foreign, side, solana } = input;
  const foreignInfo = useForeignToken(foreign, input.evmAddress, input.refresh);
  const foreignDecimals = foreignInfo?.decimals ?? null;
  const fromDecimals = side === "buy" ? foreignDecimals : solana.decimals;
  let units: bigint | null = null;
  try {
    units = foreign && fromDecimals !== null && Number(input.amount) > 0 ? toBaseUnits(input.amount, fromDecimals) : null;
  } catch {}
  const request =
    foreign && units && units > 0n
      ? side === "buy"
        ? {
            fromChain: foreign.chain.id,
            toChain: LIFI_SOLANA_CHAIN,
            fromToken: foreign.address,
            toToken: lifiSolanaToken(solana.mint),
            amount: units,
            fromAddress: input.evmAddress ?? QUOTE_ONLY_EVM,
            toAddress: input.solanaAddress ?? QUOTE_ONLY_SOLANA,
            slippageBps: input.slippageBps,
          }
        : {
            fromChain: LIFI_SOLANA_CHAIN,
            toChain: foreign.chain.id,
            fromToken: lifiSolanaToken(solana.mint),
            toToken: foreign.address,
            amount: units,
            fromAddress: input.solanaAddress ?? QUOTE_ONLY_SOLANA,
            toAddress: input.evmAddress ?? QUOTE_ONLY_EVM,
            slippageBps: input.slippageBps,
          }
      : null;
  const key = request ? JSON.stringify({ ...request, amount: request.amount.toString() }) : null;
  const [quote, setQuote] = useState<{ key: string; best?: DirectQuote; error?: string } | null>(null);
  const [pending, setPending] = useState<{ ref: BridgeLegRef; fromChain: number; since: number; explorerUrl: string; summary: string } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!key || !request || pending) return setQuote(null);
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const { quoteDirectSwap } = await import("@/lib/venues/bridge-leg");
        const result = await quoteDirectSwap(request);
        if (active) setQuote(result.best ? { key, best: result.best } : { key, error: result.error ?? "No cross-chain route for this swap right now." });
      } catch (caught) {
        if (active) setQuote({ key, error: errorMessage(caught) });
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers every input
  }, [key, pending]);

  // Follow the sent route until it fills (or fails and refunds).
  useEffect(() => {
    if (!pending) return;
    const current = pending;
    const timer = window.setInterval(async () => {
      const { bridgeLegState } = await import("@/lib/venues/bridge-leg");
      const state = await bridgeLegState(current.ref, current.fromChain).catch(() => "pending" as const);
      if (state === "pending" && Date.now() - current.since < FILL_TIMEOUT_MS) return;
      setPending(null);
      toast(
        state === "filled"
          ? { tone: "success", title: "Cross-chain swap done", message: current.summary, link: { href: current.explorerUrl, label: "View transaction" } }
          : {
              tone: "error",
              title: state === "failed" ? "Refunded" : "The swap is taking longer than usual",
              message: state === "failed" ? "LI.FI couldn't fill it and returned the funds where they came from." : "Check the transaction; LI.FI refunds if it can't fill.",
              link: { href: current.explorerUrl, label: "View transaction" },
            },
      );
    }, FILL_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poller per send
  }, [pending]);

  const best = quote && quote.key === key ? quote.best : undefined;
  const toDecimals = side === "buy" ? solana.decimals : foreignDecimals;
  const receive = best && toDecimals !== null ? fromBaseUnits(best.raw.expectedOut, toDecimals) : null;
  const balance = side === "buy" ? (foreignInfo?.balance != null && foreignDecimals !== null ? fromBaseUnits(foreignInfo.balance, foreignDecimals) : null) : null;

  /** Sends the route with a fresh quote; resolves once it's sent (the fill is followed in the background). */
  const execute = async (wallets: { evmProvider: import("viem").EIP1193Provider | null; signSolana: Parameters<typeof import("@/lib/venues/bridge-leg").sendDirectSwap>[1]["solana"] }) => {
    if (!request || !foreign || !units || !input.evmAddress || !input.solanaAddress) return false;
    setSending(true);
    try {
      const { quoteDirectSwap, sendDirectSwap } = await import("@/lib/venues/bridge-leg");
      const fresh = await quoteDirectSwap({ ...request, fromAddress: side === "buy" ? input.evmAddress : input.solanaAddress, toAddress: side === "buy" ? input.solanaAddress : input.evmAddress });
      if (!fresh.best) throw new Error(fresh.error ?? "No cross-chain route for this swap right now.");
      if (side === "buy" && !wallets.evmProvider) throw new Error(`Connect an EVM wallet to pay from ${foreign.chain.name}.`);
      const sent = await sendDirectSwap(fresh.best, {
        provider: wallets.evmProvider!,
        account: input.evmAddress,
        source: side === "buy" ? sourceChainById(foreign.chain.id) : null,
        solana: wallets.signSolana,
        units,
      });
      const out = toDecimals !== null ? fromBaseUnits(fresh.best.raw.expectedOut, toDecimals) : 0;
      const summary =
        side === "buy"
          ? `${input.amount} ${foreign.symbol} on ${foreign.chain.name} → about ${out.toPrecision(6)} ${solana.symbol} on Solana`
          : `${input.amount} ${solana.symbol} on Solana → about ${out.toPrecision(6)} ${foreign.symbol} on ${foreign.chain.name}`;
      setPending({ ref: sent.ref, fromChain: request.fromChain, since: Date.now(), explorerUrl: sent.explorerUrl, summary });
      toast({ tone: "info", title: "Cross-chain swap sent", message: `${summary}. It usually lands within a minute.`, link: { href: sent.explorerUrl, label: "View transaction" } });
      const usd = Math.round((side === "buy" ? out : Number(input.amount)) * (input.solanaPrice ?? 0) * 100) / 100;
      recordSwap(input.solanaAddress, { tx: sent.id, at: Date.now(), chain: "solana", token: solana.mint, symbol: solana.symbol, side, amount: side === "buy" ? out : Number(input.amount), usd });
      trackTrade({ venue: "lifi", side, usd, feeBps: null, newsId: null, oneClick: false });
      return true;
    } catch (caught) {
      toast({ tone: "error", title: "Cross-chain swap not sent", message: errorMessage(caught) });
      return false;
    } finally {
      setSending(false);
    }
  };

  return {
    active: foreign !== null,
    receive,
    balance,
    route: best?.name ?? null,
    feeUsd: best?.raw.feeUsd ?? null,
    error: quote && quote.key === key ? (quote.error ?? null) : null,
    quoting: Boolean(key) && !(quote && quote.key === key),
    pending: pending !== null,
    sending,
    execute,
  };
}
