import "server-only";
import { createPublicKey, verify } from "node:crypto";
import { address, getAddressEncoder, getBase58Encoder, getProgramDerivedAddress } from "@solana/kit";
import { verifyMessage } from "viem";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { USDC_MINT } from "@/lib/venues/jupiter/config";
import { jupServerConfig } from "@/lib/venues/jupiter/server";
import { readAccountIndex } from "@/lib/venues/lighter/account";
import { lighterConfig } from "@/lib/venues/lighter/config";
import { readTitanFeeConfig } from "@/lib/venues/titan/fees";
import { isFresh, profileIdOf, readProfileMessage, type ProfileAction } from "./identity";
import { claimTransaction, creditTarget, creditVolume, readCursors, releaseTransaction, saveCursors, takeSyncSlot } from "./store";
import { hlAnglerVolume, lighterAnglerVolume, readAnglerSwap, type HlFill, type LighterTrade, type ParsedSolanaTx } from "./volume";

const TIMEOUT_MS = 10_000;
const HL_PAGE = 2000;
const HL_MAX_PAGES = 5;
const LIGHTER_PAGE = 100;
const LIGHTER_MAX_PAGES = 20;
/** Lighter orders carry the terminal tag from this release on; earlier trades can't be told apart. */
const LIGHTER_TAG_SINCE = Date.parse("2026-10-07T00:00:00Z");
const REFERRAL_PROGRAM = address("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Hyperliquid fills since the cursor that paid our builder fee (10,000 most recent fills at most, per the API). */
async function syncHyperliquid(user: string, cursor: number | null) {
  const fee = hlConfig.builder?.fee ?? 0;
  if (!fee) return null;
  let start = cursor === null ? 0 : cursor + 1;
  let usd = 0;
  let last = cursor ?? 0;
  const seen = new Set<number>();
  for (let page = 0; page < HL_MAX_PAGES; page++) {
    const fills = await json<HlFill[]>(`${hlConfig.apiUrl}/info`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "userFillsByTime", user, startTime: start, aggregateByTime: false }),
    });
    const fresh = fills.filter((fill) => !seen.has(fill.tid));
    for (const fill of fresh) seen.add(fill.tid);
    const batch = hlAnglerVolume(fresh, fee);
    usd += batch.usd;
    last = Math.max(last, batch.lastTime);
    if (fills.length < HL_PAGE) break;
    // The next page starts at the last fill's time; fills already seen at that millisecond are skipped.
    start = batch.lastTime;
  }
  return { usd, cursor: last };
}

/** Lighter trades of the wallet's account since the cursor whose own side carries the terminal tag. */
async function syncLighter(l1Address: string, cursor: number | null) {
  // Lighter answers "account not found" (code 21100) with a 400 when the wallet has no account yet.
  const response = await fetch(`${lighterConfig.apiUrl}/api/v1/accountsByL1Address?l1_address=${l1Address}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const accountIndex = readAccountIndex(await response.json().catch(() => null));
  if (accountIndex === null) return null;
  const since = Math.max(cursor ?? 0, LIGHTER_TAG_SINCE);
  const trades: LighterTrade[] = [];
  let next: string | null = null;
  let newest = since;
  for (let page = 0; page < LIGHTER_MAX_PAGES; page++) {
    const params = new URLSearchParams({ account_index: String(accountIndex), sort_by: "timestamp", limit: String(LIGHTER_PAGE) });
    if (next) params.set("cursor", next);
    const body = await json<{ trades?: LighterTrade[]; next_cursor?: string | null }>(`${lighterConfig.apiUrl}/api/v1/trades?${params}`);
    const list = body.trades ?? [];
    // Newest first: stop at the first trade the last sync already counted.
    const newer = list.filter((trade) => trade.timestamp > since);
    trades.push(...newer);
    for (const trade of newer) newest = Math.max(newest, trade.timestamp);
    if (newer.length < list.length || !body.next_cursor || list.length < LIGHTER_PAGE) break;
    next = body.next_cursor;
  }
  return { usd: lighterAnglerVolume(trades, accountIndex).usd, cursor: newest };
}

/**
 * Pulls new Angler volume for an EVM profile from Hyperliquid and Lighter, at most once a minute. Errors leave the
 * cursors where they were, so the next sync retries.
 */
export async function syncProfile(id: string) {
  if (profileIdOf(id)?.chain !== "evm" || !(await takeSyncSlot(id))) return;
  const cursors = await readCursors(id);
  const [hl, lighter] = await Promise.allSettled([syncHyperliquid(id, cursors.hl), syncLighter(id, cursors.lighter)]);
  if (hl.status === "fulfilled" && hl.value) {
    await creditVolume(id, "hyperliquid", hl.value.usd);
    await saveCursors(id, { hl: hl.value.cursor });
  } else if (hl.status === "rejected") console.warn(`[profile] Hyperliquid sync failed: ${String(hl.reason)}`);
  if (lighter.status === "fulfilled" && lighter.value) {
    await creditVolume(id, "lighter", lighter.value.usd);
    await saveCursors(id, { lighter: lighter.value.cursor });
  } else if (lighter.status === "rejected") console.warn(`[profile] Lighter sync failed: ${String(lighter.reason)}`);
}

async function referralAccounts(referral: string, mints: string[]) {
  const encoder = getAddressEncoder();
  const prefix = new TextEncoder().encode("referral_ata");
  const accounts = await Promise.all(
    mints.map(async (mint) => {
      const [pda] = await getProgramDerivedAddress({ programAddress: REFERRAL_PROGRAM, seeds: [prefix, encoder.encode(address(referral)), encoder.encode(address(mint))] });
      return pda as string;
    }),
  );
  return new Set(accounts);
}

async function fetchTransaction(signature: string): Promise<ParsedSolanaTx | null> {
  const { rpcUrl } = jupServerConfig();
  // A just-confirmed swap can take a few seconds to show up on another RPC node.
  for (let attempt = 0; attempt < 4; attempt++) {
    const body = await json<{ result?: ParsedSolanaTx | null }>(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
      }),
    });
    if (body.result) return body.result;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

export type SwapClaim = { ok: true; venue: "jupiter" | "titan"; usd: number; profile: string } | { ok: false; error: string; status: number };

/** Credits a Solana swap that paid our Jupiter referral or Titan fee, once per transaction. */
export async function claimSwap(signature: string): Promise<SwapClaim> {
  const tx = await fetchTransaction(signature);
  if (!tx) return { ok: false, error: "Transaction not found.", status: 404 };
  const balances = [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])];
  const mints = [...new Set(balances.map((entry) => entry.mint))];
  const { referral } = jupServerConfig();
  const titanWallet = process.env.TITAN_FEE_WALLET?.trim();
  const titanFee = await readTitanFeeConfig(process.env);
  const jupiter = referral
    ? readAnglerSwap(tx, { feeAccounts: await referralAccounts(referral.account, mints), feeOwners: new Set([referral.account]) }, USDC_MINT)
    : null;
  const titan =
    !jupiter && titanFee && titanWallet
      ? readAnglerSwap(tx, { feeAccounts: new Set([titanFee.usdcAccount]), feeOwners: new Set([titanWallet]) }, USDC_MINT)
      : null;
  const swap = jupiter ?? titan;
  if (!swap) return { ok: false, error: "Not a swap placed through Angler.", status: 422 };
  if (!(await claimTransaction(signature))) return { ok: false, error: "Already counted.", status: 409 };
  try {
    const profile = await creditTarget(swap.signer);
    const venue = jupiter ? "jupiter" : "titan";
    await creditVolume(profile, venue, swap.usd);
    return { ok: true, venue, usd: swap.usd, profile };
  } catch (error) {
    await releaseTransaction(signature);
    throw error;
  }
}

function verifySolanaSignature(signer: string, message: string, signatureBase58: string) {
  try {
    const key = getAddressEncoder().encode(address(signer));
    // Ed25519 SPKI header + the 32-byte key.
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(key)]);
    const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), publicKey, Buffer.from(getBase58Encoder().encode(signatureBase58)));
  } catch {
    return false;
  }
}

/**
 * Checks a signed profile message: well formed, fresh, and signed by the wallet it names (EVM personal_sign, or a
 * Solana signMessage with a base58 signature). Returns the action and the signer's profile id.
 */
export async function verifyProfileMessage(message: string, signature: string, now = Date.now()): Promise<{ action: ProfileAction; id: string } | { error: string }> {
  const parsed = readProfileMessage(message);
  if (!parsed) return { error: "Malformed message." };
  if (!isFresh(parsed.issuedAt, now)) return { error: "The signature expired. Sign again." };
  const signer = profileIdOf(parsed.address);
  if (!signer) return { error: "Unknown wallet address." };
  const valid =
    signer.chain === "evm"
      ? await verifyMessage({ address: parsed.address as `0x${string}`, message, signature: signature as `0x${string}` }).catch(() => false)
      : verifySolanaSignature(parsed.address, message, signature);
  return valid ? { action: parsed.action, id: signer.id } : { error: "The signature doesn't match the wallet." };
}
