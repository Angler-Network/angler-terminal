"use client";

import type { EIP1193Provider } from "viem";
import type { SecureClient } from "@polymarket/client";
import { VenueError } from "../types";
import { POLYGON_CHAIN_ID, polymarketBuilderCode } from "./config";

/**
 * Polymarket trading in the browser with the official SDK (`@polymarket/client`, loaded on first use). The user's EVM
 * wallet signs; their account is a Deposit Wallet the SDK derives and deploys gaslessly through Polymarket's relayer,
 * with our builder headers coming from `/api/prediction/polymarket/sign`. Orders go straight from the browser to
 * Polymarket (never through our server) and carry our builder code.
 */

const SIGN_URL = "/api/prediction/polymarket/sign";
const BRIDGE_URL = "https://bridge.polymarket.com";
/** L2 API credentials are kept for the browser session only, so a reload doesn't ask for another signature. */
const CREDS_KEY = (account: string) => `angler:polymarket:creds:${account.toLowerCase()}`;

const sdk = () => import("@polymarket/client");

export type Geoblock = { reachable: true; blocked: boolean; country: string | null } | { reachable: false };

/** Polymarket's own geoblock check, from the user's browser (its IP is the one that counts). */
export async function checkGeoblock(): Promise<Geoblock> {
  try {
    const response = await fetch("https://polymarket.com/api/geoblock", { signal: AbortSignal.timeout(8000) });
    const body = (await response.json()) as { blocked?: boolean; country?: string };
    return { reachable: true, blocked: body.blocked === true, country: body.country ?? null };
  } catch {
    // DNS blocks (e.g. Turkey) and network errors: Polymarket isn't reachable from here.
    return { reachable: false };
  }
}

function walletError(error: unknown) {
  const code = (error as { code?: number } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 4001 || /reject|denied|cancel/i.test(message)) return new VenueError("You rejected the request in your wallet.");
  return error instanceof VenueError ? error : new VenueError(message.split("\n")[0]);
}

/** A viem wallet client on Polygon (Polymarket's signatures name chain 137, and wallets refuse a mismatch). */
async function polygonWallet(provider: EIP1193Provider, account: `0x${string}`) {
  const [{ createWalletClient, custom }, { polygon }] = await Promise.all([import("viem"), import("viem/chains")]);
  const wallet = createWalletClient({ account, chain: polygon, transport: custom(provider) });
  if ((await wallet.getChainId()) !== POLYGON_CHAIN_ID) {
    try {
      await wallet.switchChain({ id: POLYGON_CHAIN_ID });
    } catch {
      await wallet.addChain({ chain: polygon });
      await wallet.switchChain({ id: POLYGON_CHAIN_ID });
    }
  }
  return wallet;
}

const sessions = new Map<string, Promise<SecureClient>>();

function readCreds(account: string) {
  try {
    const raw = sessionStorage.getItem(CREDS_KEY(account));
    return raw ? (JSON.parse(raw) as SecureClient["credentials"]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The signed-in SDK client for this wallet, created once per tab: the first time the wallet signs Polymarket's
 * ClobAuth message (and the SDK deploys the Deposit Wallet if it doesn't exist yet).
 */
export function polymarketSession(provider: EIP1193Provider, account: `0x${string}`): Promise<SecureClient> {
  const key = account.toLowerCase();
  let session = sessions.get(key);
  if (!session) {
    session = (async () => {
      if (!polymarketBuilderCode) throw new VenueError("Polymarket trading isn't configured on this site yet.");
      const [{ createSecureClient, remoteBuilderSigning }, { signerFrom }] = await Promise.all([sdk(), import("@polymarket/client/viem")]);
      const wallet = await polygonWallet(provider, account);
      const credentials = readCreds(account);
      const client = await createSecureClient({ signer: signerFrom(wallet), apiKey: remoteBuilderSigning({ url: SIGN_URL }), ...(credentials ? { credentials } : {}) });
      try {
        sessionStorage.setItem(CREDS_KEY(account), JSON.stringify(client.credentials));
      } catch {}
      return client;
    })().catch((error: unknown) => {
      sessions.delete(key);
      throw walletError(error);
    });
    sessions.set(key, session);
  }
  return session;
}

export function endPolymarketSession(account: string) {
  sessions.delete(account.toLowerCase());
  try {
    sessionStorage.removeItem(CREDS_KEY(account));
  } catch {}
}

export interface PolymarketHolding {
  assetId: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  title: string | null;
}

export interface PolymarketAccount {
  /** The Deposit Wallet that holds pUSD and positions. */
  wallet: `0x${string}`;
  /** pUSD available, in dollars. */
  balance: number;
  approved: boolean;
  holdings: PolymarketHolding[];
}

export async function loadPolymarketAccount(client: SecureClient): Promise<PolymarketAccount> {
  const [{ AssetType }, { fetchBalanceAllowance }] = await Promise.all([sdk(), import("@polymarket/client/actions")]);
  const wallet = client.account.wallet as `0x${string}`;
  const [balance, approvals, positions] = await Promise.all([
    fetchBalanceAllowance(client, { assetType: AssetType.COLLATERAL }),
    client.fetchTradingApprovalsState(),
    client
      .listPositions()
      .firstPage()
      .then((page) => page.items)
      .catch(() => []),
  ]);
  return {
    wallet,
    // pUSD has six decimals.
    balance: Number(balance.balance) / 1e6,
    approved: approvals.isFullyApproved,
    holdings: positions
      .map((position) => ({
        assetId: String(position.assetId),
        shares: Number(position.currentSize),
        avgPrice: Number(position.avgPrice),
        currentPrice: Number(position.currentPrice),
        title: (position as { title?: string }).title ?? null,
      }))
      .filter((holding) => holding.shares > 0.0001),
  };
}

/** One-time gasless approvals so the exchange contracts can move the account's pUSD and outcome tokens. */
export async function approvePolymarketTrading(client: SecureClient) {
  try {
    await client.setupTradingApprovals();
  } catch (error) {
    throw walletError(error);
  }
}

export interface PolymarketFill {
  ok: boolean;
  status: string;
  message: string | null;
}

function readResponse(response: unknown): PolymarketFill {
  const record = response as { ok?: boolean; status?: string; code?: string; message?: string };
  return { ok: record.ok === true, status: record.status ?? (record.ok ? "matched" : "rejected"), message: record.ok ? null : (record.message ?? record.code ?? "Order rejected.") };
}

/** Market buy for `usd` (all-in, fees included) that only fills at `maxPrice` or better. */
export async function buyPolymarket(client: SecureClient, order: { assetId: string; usd: number; maxPrice: number }) {
  const { OrderSide } = await sdk();
  try {
    return readResponse(
      await client.placeMarketOrder({
        assetId: order.assetId,
        side: OrderSide.BUY,
        amount: order.usd,
        maxSpend: order.usd,
        maxPrice: Math.min(0.999, order.maxPrice).toFixed(3),
        ...(polymarketBuilderCode ? { builderCode: polymarketBuilderCode } : {}),
      }),
    );
  } catch (error) {
    throw walletError(error);
  }
}

/** Market sell of `shares` that only fills at `minPrice` or better. */
export async function sellPolymarket(client: SecureClient, order: { assetId: string; shares: number; minPrice: number }) {
  const { OrderSide } = await sdk();
  try {
    return readResponse(
      await client.placeMarketOrder({
        assetId: order.assetId,
        side: OrderSide.SELL,
        shares: Math.floor(order.shares * 100) / 100,
        minPrice: Math.max(0.001, order.minPrice).toFixed(3),
        ...(polymarketBuilderCode ? { builderCode: polymarketBuilderCode } : {}),
      }),
    );
  } catch (error) {
    throw walletError(error);
  }
}

/**
 * Polymarket's bridge address for this account's EVM deposits: USDC sent there on Arbitrum, Base, Ethereum and other
 * EVM chains is converted to pUSD and credited to the Deposit Wallet.
 */
export async function polymarketDepositAddress(wallet: `0x${string}`) {
  const response = await fetch(`${BRIDGE_URL}/deposit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(polymarketBuilderCode ? { "X-Builder-Code": polymarketBuilderCode } : {}) },
    body: JSON.stringify({ address: wallet }),
  });
  const body = (await response.json().catch(() => ({}))) as { address?: { evm?: string }; evm?: string; message?: string };
  const evm = body.address?.evm ?? body.evm;
  if (!response.ok || !evm || !/^0x[0-9a-fA-F]{40}$/.test(evm)) throw new VenueError(body.message ?? "Polymarket didn't return a deposit address.");
  return evm as `0x${string}`;
}
