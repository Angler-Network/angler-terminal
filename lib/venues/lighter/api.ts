"use client";

import { VenueError } from "../types";
import { lighterConfig } from "./config";
import { LighterApiError } from "./errors";
import { readAccountIndex } from "./account";
import type { SignedTx } from "./signer";

/**
 * Lighter REST from the browser (each user spends their own rate limit: 60 requests/minute on Standard). Every
 * response carries `code`; anything but 200 throws a LighterApiError with a readable message.
 */

type Body = Record<string, unknown> & { code?: number; message?: string };

const TIMEOUT_MS = 10_000;

function url(path: string, params?: Record<string, string | number>) {
  const query = params ? `?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))}` : "";
  return `${lighterConfig.apiUrl}/api/v1/${path}${query}`;
}

async function read(response: Response): Promise<Body> {
  if (response.status === 429 || response.status === 405) {
    throw new VenueError("Lighter is rate limiting this browser. Wait a moment and try again.", `HTTP ${response.status}`);
  }
  let body: Body;
  try {
    body = (await response.json()) as Body;
  } catch {
    throw new VenueError(`Lighter answered HTTP ${response.status}.`);
  }
  if (typeof body.code === "number" && body.code !== 200) throw new LighterApiError(body.code, body.message ?? "");
  return body;
}

export async function lighterGet(path: string, params?: Record<string, string | number>, auth?: string) {
  const response = await fetch(url(path, params), {
    headers: auth ? { authorization: auth } : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return read(response);
}

/**
 * Submits a signed tx. Resolves with the hash once the API accepted it (code 200), which does NOT mean it
 * executed. API rejections throw LighterApiError (nonce not consumed); network failures throw anything else
 * (outcome unknown).
 */
export async function sendTx(tx: SignedTx): Promise<string> {
  const response = await fetch(url("sendTx"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx_type: String(tx.txType), tx_info: tx.txInfo }),
  });
  const body = await read(response);
  return typeof body.tx_hash === "string" ? body.tx_hash : tx.txHash;
}

export async function nextNonce(accountIndex: number, apiKeyIndex: number) {
  const body = await lighterGet("nextNonce", { account_index: accountIndex, api_key_index: apiKeyIndex });
  if (typeof body.nonce !== "number") throw new VenueError("Lighter returned no nonce.");
  return body.nonce;
}

const accountCache = new Map<string, { at: number; index: number | null }>();
const NO_ACCOUNT_TTL_MS = 15_000;

/** Master account index of an L1 address, or null before the first deposit is credited. */
export async function getAccountIndex(l1Address: string, { fresh = false } = {}) {
  const key = `${lighterConfig.network}:${l1Address.toLowerCase()}`;
  const cached = accountCache.get(key);
  if (!fresh && cached && (cached.index !== null || Date.now() - cached.at < NO_ACCOUNT_TTL_MS)) return cached.index;
  let index: number | null;
  try {
    index = readAccountIndex(await lighterGet("accountsByL1Address", { l1_address: l1Address }));
  } catch (error) {
    if (error instanceof LighterApiError && error.code === 21100) index = null;
    else throw error;
  }
  accountCache.set(key, { at: Date.now(), index });
  return index;
}

const FAUCET_WAIT_MS = 90_000;
const FAUCET_POLL_MS = 3_000;

/**
 * Testnet only: Lighter's faucet (the testnet app's "Request Funds", `GET /faucet`) credits test USDC to the
 * wallet, creating its account when there is none, and accepts requests while the portfolio is under $100. Waits
 * until the account shows up and resolves to its index.
 */
export async function requestTestFunds(l1Address: string) {
  if (lighterConfig.network !== "testnet") throw new VenueError("Lighter's faucet only exists on testnet.");
  try {
    await lighterGet("faucet", { l1_address: l1Address, do_l1_transfer: "false" });
  } catch (error) {
    if (error instanceof LighterApiError) {
      throw new VenueError(`Lighter's faucet refused: ${error.message || "try again later"}. It sends more only while your Lighter balance is under $100.`, String(error.code));
    }
    throw error;
  }
  const deadline = Date.now() + FAUCET_WAIT_MS;
  while (Date.now() < deadline) {
    const index = await getAccountIndex(l1Address, { fresh: true }).catch(() => null);
    if (index !== null) return index;
    await new Promise((resolve) => setTimeout(resolve, FAUCET_POLL_MS));
  }
  throw new VenueError("Lighter accepted the request but the account isn't visible yet. Check again in a minute.");
}

/** Public key registered at an API key index ("" when none), without 0x. */
export async function registeredPublicKey(accountIndex: number, apiKeyIndex: number) {
  try {
    const body = await lighterGet("apikeys", { account_index: accountIndex, api_key_index: apiKeyIndex });
    const keys = Array.isArray(body.api_keys) ? (body.api_keys as Array<{ api_key_index?: number; public_key?: string }>) : [];
    return keys.find((entry) => entry.api_key_index === apiKeyIndex)?.public_key ?? "";
  } catch (error) {
    if (error instanceof LighterApiError && error.code === 21109) return "";
    throw error;
  }
}

/** Best bid and ask from the book (null when a side is empty). */
export async function bestPrices(marketId: number) {
  const body = await lighterGet("orderBookOrders", { market_id: marketId, limit: 1 });
  const first = (side: unknown) => {
    const price = Array.isArray(side) ? Number((side[0] as { price?: string } | undefined)?.price) : NaN;
    return price > 0 ? price : null;
  };
  return { bid: first(body.bids), ask: first(body.asks) };
}

/** Orders by client order index (auth required). */
export async function accountOrders(accountIndex: number, clientOrderIndexes: number[], auth: string) {
  const body = await lighterGet("accountOrders", { account_index: accountIndex, client_order_indexes: clientOrderIndexes.join(",") }, auth);
  return Array.isArray(body.orders) ? (body.orders as unknown[]) : [];
}

/** Tx status: 0 failed, 1 pending, 2 executed, 3 pending (final). Null while the tx isn't known yet. */
export async function txStatus(hash: string) {
  try {
    const body = await lighterGet("tx", { by: "hash", value: hash });
    return { status: Number(body.status), eventInfo: typeof body.event_info === "string" ? body.event_info : "" };
  } catch (error) {
    if (error instanceof LighterApiError && error.code === 21500) return null;
    throw error;
  }
}

/** "std", "plus" or "premium"; partner fees above zero need Plus or Premium. */
export async function userTier(accountIndex: number, auth: string) {
  const body = await lighterGet("accountLimits", { account_index: accountIndex }, auth);
  return typeof body.user_tier === "string" ? body.user_tier : "std";
}
