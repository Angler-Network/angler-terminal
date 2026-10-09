import "server-only";
import { readBetaWindow } from "@/lib/ops/beta";
import { LIFI_API_URL, readLifiServerConfig } from "@/lib/venues/lifi-server";
import { RELAY_API_URL, readRelayServerConfig } from "@/lib/venues/relay-server";
import { readAcrossServerConfig } from "@/lib/venues/across-server";
import { EVM_SWAP_CHAINS } from "@/lib/venues/uniswap/chains";
import { rpc, usdOf } from "./evm-swap-server";
import type { EvmTx } from "./evm-swap";
import { inBeta } from "./beta-points";
import { carriesRecipient, readAcrossDeposit, readAcrossStatus, readLifiTransfer, readRelayRequest } from "./bridge-points";
import { profileIdOf } from "./identity";
import { pointsShareFor } from "./levels";
import { claimTransaction, creditTarget, creditVolume, releaseTransaction } from "./store";

/**
 * Credits a Relay request, a LI.FI transfer or an Across deposit (`id` = `<originChainId>:<depositId>`) that carried our fee to the sender's profile, once each (`bridge-points.ts`
 * reads the records). Points scale with our fee there (`pointsShareFor`); the volume counts in full.
 */

export type BridgeProvider = "relay" | "lifi" | "across";
export type BridgeClaimResult = { ok: true; venue: BridgeProvider; usd: number; profile: string } | { ok: false; error: string; status: number };

const TIMEOUT_MS = 10_000;
const ATTEMPTS = 4;

async function getJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers: { accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown };
}

/** The record, read until it's final: a claim can arrive before the bridge has indexed the transfer. */
async function readRecord<T>(read: () => Promise<T | null>) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const found = await read();
    if (found) return found;
    if (attempt < ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}

const ACROSS_INDEXER = "https://indexer.api.across.to";

/**
 * An Across deposit as a claim: filled per the indexer, its origin transaction (read on the origin chain's RPC) sent by
 * the user and carrying our app fee recipient, the input priced. undefined when our app fee isn't set.
 */
async function readAcrossClaim(id: string) {
  const { appFee, appFeeRecipient } = readAcrossServerConfig(process.env);
  if (!appFee || !appFeeRecipient) return undefined;
  const [origin, depositId] = id.split(":");
  const chain = EVM_SWAP_CHAINS.find((entry) => entry.id === Number(origin));
  if (!chain || !/^\d+$/.test(depositId ?? "")) return null;
  const status = await readRecord(async () => readAcrossStatus((await getJson(`${ACROSS_INDEXER}/deposit/status?depositId=${depositId}&originChainId=${chain.id}`)).body));
  if (!status) return null;
  const [deposit, tx] = await Promise.all([
    getJson(`${ACROSS_INDEXER}/deposit?depositTxHash=${status.depositTxHash}&originChainId=${chain.id}`).then((response) => readAcrossDeposit(response.body)),
    rpc<EvmTx>(chain, "eth_getTransactionByHash", [status.depositTxHash]),
  ]);
  if (!deposit || !tx || !carriesRecipient(tx.input, appFeeRecipient)) return null;
  const usd = await usdOf(chain, { token: deposit.inputToken, amount: deposit.inputAmount }).catch(() => null);
  return usd && usd > 0 ? { user: tx.from.toLowerCase(), usd, bps: appFee * 10_000 } : null;
}

export async function claimBridge(provider: BridgeProvider, id: string): Promise<BridgeClaimResult> {
  let claim: { user: string; usd: number; bps: number } | null = null;
  if (provider === "relay") {
    const fee = readRelayServerConfig(process.env).fee;
    if (!fee) return { ok: false, error: "No Angler fee on Relay, so no points.", status: 422 };
    claim = await readRecord(async () => readRelayRequest((await getJson(`${RELAY_API_URL}/requests/v2?id=${encodeURIComponent(id)}`)).body, fee.recipient));
  } else if (provider === "across") {
    const across = await readAcrossClaim(id);
    if (across === undefined) return { ok: false, error: "No Angler fee on Across, so no points.", status: 422 };
    claim = across;
  } else {
    const config = readLifiServerConfig(process.env);
    const bps = config.fee ? Number(config.fee) * 10_000 : 0;
    if (!config.integrator || !(bps > 0)) return { ok: false, error: "No Angler fee on LI.FI, so no points.", status: 422 };
    const headers: Record<string, string> = config.apiKey ? { "x-lifi-api-key": config.apiKey } : {};
    const integrator = config.integrator;
    const transfer = await readRecord(async () => readLifiTransfer((await getJson(`${LIFI_API_URL}/status?txHash=${encodeURIComponent(id)}`, headers)).body, integrator));
    claim = transfer ? { ...transfer, bps } : null;
  }
  if (!claim) return { ok: false, error: "Not a finished route placed through Angler.", status: 422 };
  const owner = profileIdOf(claim.user);
  if (!owner) return { ok: false, error: "Unknown sender.", status: 422 };
  const key = `${provider}:${id.toLowerCase()}`;
  if (!(await claimTransaction(key))) return { ok: false, error: "Already counted.", status: 409 };
  try {
    const profile = await creditTarget(owner.id);
    // Claims come as the route finishes: its time is now.
    await creditVolume(profile, provider, claim.usd, (claim.usd * claim.bps) / 10_000, 0, {
      betaUsd: inBeta(await readBetaWindow(), Date.now()) ? claim.usd : 0,
      pointsShare: pointsShareFor(claim.bps),
    });
    return { ok: true, venue: provider, usd: claim.usd, profile };
  } catch (error) {
    await releaseTransaction(key);
    throw error;
  }
}
