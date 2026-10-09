"use client";

import type { EIP1193Provider } from "viem";
import { PROVIDERS, bridgeEnabled, type BridgeProvider } from "./bridge-switch";
import { summarizeAcrossQuote, type AcrossQuoteRequest, type AcrossQuoteSummary } from "./across";
import type { AcrossQuote } from "./across-client";
import { publicClientOn, readUsdcBalance, walletOn } from "./deposit-client";
import type { SourceChain } from "./deposits";
import { LIFI_SOLANA_CHAIN, lifiErrorMessage, lifiFillState, lifiQuoteParams, readLifiQuote, type LifiQuote, type LifiQuoteRequest } from "./lifi";
import { readRelayQuote, relayErrorMessage, relayFillState, relayQuoteBody, relaySwapBody, type RelayQuote, type RelaySwapRequest } from "./relay";
import { VenueError } from "./types";

/**
 * One bridge leg (a `FundsStep` of kind "across": the funds window, the swap cards) quoted on Across, Relay and LI.FI
 * at once; the larger output runs (on a tie the earlier one: Across, then Relay). The clients load on demand.
 */

export type { BridgeProvider } from "./bridge-switch";

export const BRIDGE_PROVIDER_NAMES: Record<BridgeProvider, string> = { across: "Across", relay: "Relay", lifi: "LI.FI" };
export { bridgeEnabled, setEnabledBridges } from "./bridge-switch";

const off = (provider: BridgeProvider) => Promise.reject(new VenueError(`${BRIDGE_PROVIDER_NAMES[provider]} is turned off.`));

export type BridgeLegQuote = AcrossQuoteSummary & { provider: BridgeProvider } & (
    | { provider: "across"; raw: AcrossQuote }
    | { provider: "relay"; raw: RelayQuote }
    | { provider: "lifi"; raw: LifiQuote }
  );

export interface BridgeLegQuotes {
  /** The executable quote with the larger output, or null with every provider's reason in `quotes`. */
  best: BridgeLegQuote | null;
  quotes: Array<{ provider: BridgeProvider; quote?: BridgeLegQuote; error?: string }>;
}

/** How a sent leg is followed until it fills. */
export type BridgeLegRef =
  | { provider: "across"; depositId: bigint }
  | { provider: "relay"; requestId: string }
  | { provider: "lifi"; txHash: string; fromChain: number; toChain: number };

const message = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught));

async function quoteAcross(request: AcrossQuoteRequest): Promise<BridgeLegQuote> {
  const { fetchAcrossQuote } = await import("./across-client");
  const raw = await fetchAcrossQuote(request);
  return { ...summarizeAcrossQuote(raw), provider: "across", raw };
}

/** A Relay quote for any token pair (a bridge leg's dollars, or the swap card's cross-chain swaps). */
export async function fetchRelayQuote(request: RelaySwapRequest): Promise<RelayQuote> {
  let response: Response;
  try {
    response = await fetch("/api/relay/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(relaySwapBody(request)) });
  } catch {
    throw new VenueError("Relay is unreachable right now.");
  }
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) throw new VenueError(relayErrorMessage(body, response.status));
  const raw = readRelayQuote(body, request.originChainId);
  if (!raw) throw new VenueError("Relay sent a quote this terminal can't read.");
  return raw;
}

async function quoteRelay(request: AcrossQuoteRequest): Promise<BridgeLegQuote> {
  const body = relayQuoteBody(request);
  const raw = await fetchRelayQuote({ ...body, amount: request.units });
  const { requestId: _requestId, txs: _txs, ...summary } = raw;
  return { ...summary, provider: "relay", raw };
}

/** A LI.FI quote for any token pair on any two chains (EVM or Solana). */
export async function fetchLifiQuote(request: LifiQuoteRequest): Promise<LifiQuote> {
  let response: Response;
  try {
    response = await fetch(`/api/lifi/quote?${lifiQuoteParams(request)}`, { cache: "no-store" });
  } catch {
    throw new VenueError("LI.FI is unreachable right now.");
  }
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) throw new VenueError(lifiErrorMessage(body, response.status));
  const raw = readLifiQuote(body, request.fromChain);
  if (!raw) throw new VenueError("LI.FI sent a quote this terminal can't read.");
  return raw;
}

async function quoteLifi(request: AcrossQuoteRequest): Promise<BridgeLegQuote> {
  const raw = await fetchLifiQuote({
    fromChain: request.from.chainId,
    toChain: request.to.chainId,
    fromToken: request.from.usdc,
    toToken: request.to.usdc,
    fromAmount: request.units,
    fromAddress: request.depositor,
    toAddress: request.recipient,
  });
  const { tool: _tool, toolName: _toolName, toChainId: _toChainId, approval: _approval, tx: _tx, ...summary } = raw;
  return { ...summary, provider: "lifi", raw };
}

/**
 * Sends a LI.FI quote's EVM transaction on its origin chain: an exact ERC-20 approval first when the allowance is
 * short, then the route's transaction. Resolves to its hash.
 */
export async function sendLifiEvm(provider: EIP1193Provider, account: `0x${string}`, from: SourceChain, quote: LifiQuote, units: bigint) {
  const tx = quote.tx;
  if (tx?.kind !== "evm" || tx.chainId !== from.chainId) throw new VenueError("LI.FI's quote can't be sent from this wallet.");
  const [{ wallet, chain }, client, { erc20Abi }] = await Promise.all([walletOn(provider, account, from), publicClientOn(from), import("viem")]);
  if (quote.approval) {
    const allowance = await client.readContract({ address: quote.approval.token, abi: erc20Abi, functionName: "allowance", args: [account, quote.approval.spender] });
    if (allowance < units) {
      const approval = await wallet.writeContract({ account, chain, address: quote.approval.token, abi: erc20Abi, functionName: "approve", args: [quote.approval.spender, units] });
      const receipt = await client.waitForTransactionReceipt({ hash: approval });
      if (receipt.status !== "success") throw new VenueError("The approval reverted. Nothing was sent.");
    }
  }
  const hash = await wallet.sendTransaction({ account, chain, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new VenueError("The LI.FI transaction reverted. Nothing was sent.");
  return { hash, explorerUrl: `${from.explorer}/tx/${hash}` };
}

/** One look at a sent LI.FI route by its origin transaction. */
export async function lifiTxState(txHash: string, fromChain: number, toChain: number) {
  const response = await fetch(`/api/lifi/status?${new URLSearchParams({ txHash, fromChain: String(fromChain), toChain: String(toChain) })}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as unknown;
  // Not indexed yet answers 404: keep waiting.
  if (response.status === 404) return "pending" as const;
  if (!response.ok) throw new VenueError(lifiErrorMessage(body, response.status));
  return lifiFillState(body);
}

/** Sends a Relay quote's transactions on its origin chain, each confirmed before the next; resolves to the last hash. */
export async function sendRelayTxs(provider: EIP1193Provider, account: `0x${string}`, from: SourceChain, quote: RelayQuote) {
  const [{ wallet, chain }, client] = await Promise.all([walletOn(provider, account, from), publicClientOn(from)]);
  let hash: `0x${string}` | undefined;
  for (const tx of quote.txs) {
    hash = await wallet.sendTransaction({ account, chain, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new VenueError("The Relay transaction reverted. Nothing was sent.");
  }
  if (!hash) throw new VenueError("Relay's quote had nothing to send.");
  return { hash, explorerUrl: `${from.explorer}/tx/${hash}` };
}

export async function quoteBridgeLeg(request: AcrossQuoteRequest): Promise<BridgeLegQuotes> {
  const results = await Promise.allSettled([
    bridgeEnabled("across") ? quoteAcross(request) : off("across"),
    bridgeEnabled("relay") ? quoteRelay(request) : off("relay"),
    bridgeEnabled("lifi") ? quoteLifi(request) : off("lifi"),
  ]);
  const quotes = PROVIDERS.map((provider, index) => {
    const result = results[index];
    return result.status === "fulfilled" ? { provider, quote: result.value } : { provider, error: message(result.reason) };
  });
  let best: BridgeLegQuote | null = null;
  for (const entry of quotes) {
    const quote = entry.quote;
    if (quote?.executable && (!best || quote.expectedOut > best.expectedOut)) best = quote;
  }
  return { best, quotes };
}

/** The reason a leg has no route: the first enabled provider's error, else a plain line. */
export function noRouteReason(result: BridgeLegQuotes) {
  return result.quotes.find((entry) => entry.error && bridgeEnabled(entry.provider))?.error ?? "No bridge has a route for this amount right now.";
}

/**
 * Sends the chosen quote from the origin chain: Across through its SDK (approval + deposit), Relay as the
 * transactions its quote lists, LI.FI as an approval when needed plus its transaction, each confirmed before the next.
 * Resolves once the deposit is in.
 */
export async function executeBridgeLeg(provider: EIP1193Provider, account: `0x${string}`, from: SourceChain, to: SourceChain, units: bigint, quote: BridgeLegQuote) {
  if (quote.provider === "across") {
    const { executeAcross } = await import("./across-client");
    const sent = await executeAcross(provider, account, from, to, quote.raw);
    return { ref: { provider: "across", depositId: sent.depositId } as BridgeLegRef, explorerUrl: sent.explorerUrl };
  }
  // Relay and LI.FI don't check balances in their quotes: refuse here rather than send a deposit that reverts.
  if ((await readUsdcBalance(from, account)) < units) throw new VenueError(`Not enough ${from.symbol} in your wallet on ${from.name}.`);
  if (quote.provider === "lifi") {
    const sent = await sendLifiEvm(provider, account, from, quote.raw, units);
    return { ref: { provider: "lifi", txHash: sent.hash, fromChain: from.chainId, toChain: to.chainId } as BridgeLegRef, explorerUrl: sent.explorerUrl };
  }
  const sent = await sendRelayTxs(provider, account, from, quote.raw);
  return { ref: { provider: "relay", requestId: quote.raw.requestId } as BridgeLegRef, explorerUrl: sent.explorerUrl };
}

/** One look at a sent leg: pending, filled on the destination, or failed (refunded on the origin chain). */
export async function bridgeLegState(ref: BridgeLegRef, originChainId: number) {
  if (ref.provider === "across") {
    const { acrossFilled } = await import("./across-client");
    return acrossFilled(ref.depositId, originChainId);
  }
  if (ref.provider === "lifi") return lifiTxState(ref.txHash, ref.fromChain, ref.toChain);
  return relayRequestState(ref.requestId);
}

export async function relayRequestState(requestId: string) {
  const response = await fetch(`/api/relay/intents/status/v2?requestId=${requestId}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { status?: unknown };
  if (!response.ok) throw new VenueError(relayErrorMessage(body, response.status));
  return relayFillState(body.status);
}

/** Signs a base64 Solana transaction with the connected wallet (`useSolanaWallet().signTransaction`). */
type SolanaSigner = (transactionBase64: string) => Promise<string>;

/**
 * Signs a LI.FI Solana route in the wallet and sends it through our RPC (`/api/solana/send`). A send that isn't
 * confirmed within the server's wait still counts as sent: the status poll decides.
 */
export async function sendLifiSolana(sign: SolanaSigner, quote: LifiQuote) {
  if (quote.tx?.kind !== "solana") throw new VenueError("LI.FI's quote can't be signed by a Solana wallet.");
  const signed = await sign(quote.tx.data);
  const response = await fetch("/api/solana/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: signed }) });
  const body = (await response.json().catch(() => ({}))) as { status?: unknown; signature?: unknown; error?: unknown };
  const signature = typeof body.signature === "string" ? body.signature : "";
  const notYet = typeof body.error === "string" && body.error.startsWith("Not confirmed");
  if (!signature || (body.status !== "Success" && !notYet)) throw new VenueError(typeof body.error === "string" ? body.error : "The Solana transaction wasn't sent.");
  return { signature, explorerUrl: `https://solscan.io/tx/${signature}` };
}

/** A cross-chain swap of any token pair in one go (the EVM swap card's "direct" route), EVM or Solana on either side. */
export interface DirectSwapRequest {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  amount: bigint;
  fromAddress: string;
  toAddress: string;
  slippageBps?: number | null;
  /** A route the user pinned (`directRouteId`): used whenever it still quotes, the best one otherwise. */
  prefer?: string | null;
}

/** One route's identity across refreshes: the provider, and for LI.FI the bridge or DEX it picked. */
export type DirectQuote = { provider: "relay"; raw: RelayQuote; name: string; id: string } | { provider: "lifi"; raw: LifiQuote; name: string; id: string };

export const directRouteId = (quote: Pick<DirectQuote, "provider"> & { raw: { tool?: string } }) => (quote.provider === "lifi" ? `lifi:${quote.raw.tool ?? ""}` : "relay");

/**
 * Every route for a swap across chains (or tokens), best first: Relay (EVM ↔ EVM only here) and LI.FI (any pair, Solana
 * included). Where Relay can't help (Solana), LI.FI is asked once more without its first bridge, so there's still a
 * choice; between EVM chains Relay already is the second route and LI.FI's rate limit is kept for that. `best` is the
 * pinned route (`prefer`) while it quotes, else the largest output, Relay on a tie.
 */
export async function quoteDirectSwap(request: DirectSwapRequest): Promise<{ best: DirectQuote | null; options: DirectQuote[]; error?: string }> {
  const evmOnly = request.fromChain !== LIFI_SOLANA_CHAIN && request.toChain !== LIFI_SOLANA_CHAIN;
  const lifiRequest = { fromChain: request.fromChain, toChain: request.toChain, fromToken: request.fromToken, toToken: request.toToken, fromAmount: request.amount, fromAddress: request.fromAddress, toAddress: request.toAddress, slippageBps: request.slippageBps };
  const [relay, lifi] = await Promise.allSettled([
    evmOnly && bridgeEnabled("relay")
      ? fetchRelayQuote({
          user: request.fromAddress,
          recipient: request.toAddress,
          originChainId: request.fromChain,
          destinationChainId: request.toChain,
          originCurrency: request.fromToken,
          destinationCurrency: request.toToken,
          amount: request.amount,
        })
      : Promise.reject(new VenueError(evmOnly ? "Relay is turned off." : "Relay isn't used for Solana here.")),
    bridgeEnabled("lifi") ? fetchLifiQuote(lifiRequest) : off("lifi"),
  ]);
  const options: DirectQuote[] = [];
  if (relay.status === "fulfilled" && relay.value.executable) options.push({ provider: "relay", raw: relay.value, name: "Relay", id: "relay" });
  if (lifi.status === "fulfilled" && lifi.value.executable) {
    options.push({ provider: "lifi", raw: lifi.value, name: `LI.FI · ${lifi.value.toolName}`, id: directRouteId({ provider: "lifi", raw: lifi.value }) });
    if (!evmOnly && request.fromChain !== request.toChain) {
      const second = await fetchLifiQuote({ ...lifiRequest, denyBridges: [lifi.value.tool] }).catch(() => null);
      if (second?.executable && second.tool !== lifi.value.tool) options.push({ provider: "lifi", raw: second, name: `LI.FI · ${second.toolName}`, id: directRouteId({ provider: "lifi", raw: second }) });
    }
  }
  options.sort((a, b) => (a.raw.expectedOut === b.raw.expectedOut ? (a.provider === "relay" ? -1 : 1) : a.raw.expectedOut > b.raw.expectedOut ? -1 : 1));
  const best = (request.prefer ? options.find((option) => option.id === request.prefer) : undefined) ?? options[0] ?? null;
  if (best) return { best, options };
  const reasons = [lifi, ...(evmOnly ? [relay] : [])].filter((result) => result.status === "rejected").map((result) => message((result as PromiseRejectedResult).reason));
  return { best: null, options, error: reasons[0] ?? "No route for this swap right now." };
}

/** Sends a direct swap's chosen quote; resolves to how to follow it and where to look. */
export async function sendDirectSwap(
  quote: DirectQuote,
  wallets: { provider: EIP1193Provider; account: `0x${string}`; source: SourceChain | null; solana: SolanaSigner | null; units: bigint },
): Promise<{ ref: BridgeLegRef; id: string; explorerUrl: string }> {
  if (quote.provider === "lifi" && quote.raw.tx?.kind === "solana") {
    if (!wallets.solana) throw new VenueError("Connect a Solana wallet to send from Solana.");
    const sent = await sendLifiSolana(wallets.solana, quote.raw);
    return { ref: { provider: "lifi", txHash: sent.signature, fromChain: LIFI_SOLANA_CHAIN, toChain: Number(quote.raw.toChainId) }, id: sent.signature, explorerUrl: sent.explorerUrl };
  }
  if (!wallets.source) throw new VenueError("Swaps from this chain aren't supported yet.");
  if (quote.provider === "lifi") {
    const sent = await sendLifiEvm(wallets.provider, wallets.account, wallets.source, quote.raw, wallets.units);
    return { ref: { provider: "lifi", txHash: sent.hash, fromChain: wallets.source.chainId, toChain: Number(quote.raw.toChainId) }, id: sent.hash, explorerUrl: sent.explorerUrl };
  }
  const sent = await sendRelayTxs(wallets.provider, wallets.account, wallets.source, quote.raw);
  return { ref: { provider: "relay", requestId: quote.raw.requestId }, id: quote.raw.requestId, explorerUrl: sent.explorerUrl };
}
