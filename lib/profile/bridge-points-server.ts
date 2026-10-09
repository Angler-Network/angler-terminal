import "server-only";
import { readBetaWindow } from "@/lib/ops/beta";
import { LIFI_API_URL, readLifiServerConfig } from "@/lib/venues/lifi-server";
import { RELAY_API_URL, readRelayServerConfig } from "@/lib/venues/relay-server";
import { inBeta } from "./beta-points";
import { readLifiTransfer, readRelayRequest } from "./bridge-points";
import { profileIdOf } from "./identity";
import { pointsShareFor } from "./levels";
import { claimTransaction, creditTarget, creditVolume, releaseTransaction } from "./store";

/**
 * Credits a Relay request or a LI.FI transfer that carried our fee to the sender's profile, once each (`bridge-points.ts`
 * reads the records). Points scale with our fee there (`pointsShareFor`); the volume counts in full.
 */

export type BridgeProvider = "relay" | "lifi";
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

export async function claimBridge(provider: BridgeProvider, id: string): Promise<BridgeClaimResult> {
  let claim: { user: string; usd: number; bps: number } | null = null;
  if (provider === "relay") {
    const fee = readRelayServerConfig(process.env).fee;
    if (!fee) return { ok: false, error: "No Angler fee on Relay, so no points.", status: 422 };
    claim = await readRecord(async () => readRelayRequest((await getJson(`${RELAY_API_URL}/requests/v2?id=${encodeURIComponent(id)}`)).body, fee.recipient));
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
