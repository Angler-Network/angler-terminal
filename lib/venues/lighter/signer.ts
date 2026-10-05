"use client";

import { VenueError } from "../types";

/**
 * Lighter's official signer (lighter-go ./wasm, built by scripts/build-lighter-signer.sh into public/lighter/).
 * Loaded lazily the first time Lighter needs to sign, so other pages never download the ~4 MB (gzip) binary.
 *
 * Rules from the docs: every Sign* function is a positional global whose last two args are apiKeyIndex,
 * accountIndex; pass 0 for unused args; check `error` on every result; CreateClient gets "" as URL and all HTTP
 * (including nonces) goes through fetch, never CheckClient or nonce -1.
 */

const GLUE_URL = "/lighter/wasm_exec.js";
const WASM_URL = "/lighter/lighter-signer.wasm";

export interface SignedTx {
  txType: number;
  /** JSON string, sent as tx_info. */
  txInfo: string;
  txHash: string;
  /** ChangePubKey and ApproveIntegrator: the message the L1 wallet signs (personal_sign). */
  messageToSign?: string;
}

type Result<T> = T & { error?: string };

interface SignerGlobals {
  Go: new () => { importObject: WebAssembly.Imports; run: (instance: WebAssembly.Instance) => Promise<void> };
  GenerateAPIKey: () => Result<{ privateKey: string; publicKey: string }>;
  CreateClient: (url: string, privateKey: string, chainId: number, apiKeyIndex: number, accountIndex: number) => Result<object>;
  CreateAuthToken: (deadline: number, apiKeyIndex: number, accountIndex: number) => Result<{ authToken: string }>;
  SignChangePubKey: (publicKey: string, skipNonce: number, nonce: number, apiKeyIndex: number, accountIndex: number) => Result<SignedTx>;
  SignCreateOrder: (...args: number[]) => Result<SignedTx>;
  SignCreateGroupedOrders: (grouping: number, orders: Array<Record<string, number>>, ...args: number[]) => Result<SignedTx>;
  SignCancelOrder: (...args: number[]) => Result<SignedTx>;
  SignUpdateLeverage: (...args: number[]) => Result<SignedTx>;
  SignApproveIntegrator: (...args: number[]) => Result<SignedTx>;
}

function check<T>(result: Result<T> | undefined, what: string): T {
  if (!result) throw new VenueError(`Lighter signer returned nothing for ${what}.`);
  if (result.error) throw new VenueError(`Lighter signer: ${result.error}`, result.error);
  return result;
}

function loadGlue() {
  return new Promise<void>((resolve, reject) => {
    if ((globalThis as unknown as Partial<SignerGlobals>).Go) return resolve();
    const script = document.createElement("script");
    script.src = GLUE_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new VenueError("Couldn't load the Lighter signer."));
    document.head.appendChild(script);
  });
}

async function instantiate(go: InstanceType<SignerGlobals["Go"]>) {
  const response = fetch(WASM_URL);
  try {
    return (await WebAssembly.instantiateStreaming(response, go.importObject)).instance;
  } catch {
    // Some hosts serve .wasm without application/wasm; compile from bytes instead.
    const bytes = await (await fetch(WASM_URL)).arrayBuffer();
    return (await WebAssembly.instantiate(bytes, go.importObject)).instance;
  }
}

let loading: Promise<SignerGlobals> | null = null;

function loadSigner() {
  loading ??= (async () => {
    if (typeof window === "undefined") throw new VenueError("The Lighter signer only runs in the browser.");
    await loadGlue();
    const globals = globalThis as unknown as SignerGlobals;
    const go = new globals.Go();
    const instance = await instantiate(go);
    // Not awaited: the Go runtime keeps running and serves the exported functions.
    void go.run(instance);
    if (typeof globals.SignCreateOrder !== "function") throw new VenueError("The Lighter signer didn't start.");
    return globals;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Private keys the signer currently holds a client for, by "apiKeyIndex:accountIndex". */
const clients = new Map<string, string>();

export interface SignerContext {
  privateKey: string;
  chainId: number;
  apiKeyIndex: number;
  accountIndex: number;
}

/** The signer with a client for this key, created (or replaced, when the key changed) on demand. */
async function signerFor(context: SignerContext) {
  const signer = await loadSigner();
  const id = `${context.apiKeyIndex}:${context.accountIndex}`;
  if (clients.get(id) !== context.privateKey) {
    check(signer.CreateClient("", context.privateKey, context.chainId, context.apiKeyIndex, context.accountIndex), "CreateClient");
    clients.set(id, context.privateKey);
  }
  return signer;
}

export async function generateApiKey() {
  const signer = await loadSigner();
  return check(signer.GenerateAPIKey(), "GenerateAPIKey");
}

/** Auth token for private REST endpoints and WebSocket channels; Lighter caps the deadline at 8 hours. */
export async function createAuthToken(context: SignerContext, deadlineUnixSeconds: number) {
  const signer = await signerFor(context);
  return check(signer.CreateAuthToken(deadlineUnixSeconds, context.apiKeyIndex, context.accountIndex), "CreateAuthToken").authToken;
}

export async function signChangePubKey(context: SignerContext, publicKey: string, nonce: number) {
  const signer = await signerFor(context);
  return check(signer.SignChangePubKey(publicKey, 0, nonce, context.apiKeyIndex, context.accountIndex), "SignChangePubKey");
}

export interface CreateOrderArgs {
  marketIndex: number;
  clientOrderIndex: number;
  baseAmount: number;
  price: number;
  isAsk: boolean;
  /** 0 limit, 1 market, 2 stop-loss (market when triggered), 4 take-profit (market when triggered). */
  orderType: 0 | 1 | 2 | 4;
  /** 0 immediate-or-cancel, 1 good-till-time, 2 post-only. */
  timeInForce: 0 | 1 | 2;
  reduceOnly: boolean;
  /** Unix ms; 0 for IOC; -1 lets the signer use 28 days (TP/SL orders wait that long for their trigger). */
  orderExpiry: number;
  /** Price units, for stop-loss and take-profit orders. */
  triggerPrice?: number;
  integrator?: { accountIndex: number; takerFee: number; makerFee: number };
}

/** OTO: entry triggers one child; OCO: two siblings cancel each other; OTOCO: entry triggers an OCO pair. */
export const GROUPING = { oto: 1, oco: 2, otoco: 3 } as const;

export async function signCreateOrder(context: SignerContext, order: CreateOrderArgs, nonce: number) {
  const signer = await signerFor(context);
  return check(
    signer.SignCreateOrder(
      order.marketIndex,
      order.clientOrderIndex,
      order.baseAmount,
      order.price,
      order.isAsk ? 1 : 0,
      order.orderType,
      order.timeInForce,
      order.reduceOnly ? 1 : 0,
      order.triggerPrice ?? 0,
      order.orderExpiry,
      order.integrator?.accountIndex ?? 0,
      order.integrator?.takerFee ?? 0,
      order.integrator?.makerFee ?? 0,
      0, // selfTradeBehaviorMode: default (non-default modes can't be combined with integrator fees)
      0, // selfTradeEqualityMode
      0, // skipNonce
      nonce,
      context.apiKeyIndex,
      context.accountIndex,
    ),
    "SignCreateOrder",
  );
}

/** Several orders in one transaction (entry + TP/SL, or a TP/SL pair); integrator fields apply to the group. */
export async function signCreateGroupedOrders(
  context: SignerContext,
  grouping: (typeof GROUPING)[keyof typeof GROUPING],
  orders: Omit<CreateOrderArgs, "integrator">[],
  integrator: CreateOrderArgs["integrator"],
  nonce: number,
) {
  const signer = await signerFor(context);
  return check(
    signer.SignCreateGroupedOrders(
      grouping,
      orders.map((order) => ({
        MarketIndex: order.marketIndex,
        ClientOrderIndex: order.clientOrderIndex,
        BaseAmount: order.baseAmount,
        Price: order.price,
        IsAsk: order.isAsk ? 1 : 0,
        Type: order.orderType,
        TimeInForce: order.timeInForce,
        ReduceOnly: order.reduceOnly ? 1 : 0,
        TriggerPrice: order.triggerPrice ?? 0,
        OrderExpiry: order.orderExpiry,
      })),
      integrator?.accountIndex ?? 0,
      integrator?.takerFee ?? 0,
      integrator?.makerFee ?? 0,
      0,
      0,
      0,
      nonce,
      context.apiKeyIndex,
      context.accountIndex,
    ),
    "SignCreateGroupedOrders",
  );
}

export async function signCancelOrder(context: SignerContext, marketIndex: number, orderIndex: number, nonce: number) {
  const signer = await signerFor(context);
  return check(signer.SignCancelOrder(marketIndex, orderIndex, 0, nonce, context.apiKeyIndex, context.accountIndex), "SignCancelOrder");
}

/** `fraction` = 10000 / leverage; margin mode 0 cross, 1 isolated. */
export async function signUpdateLeverage(context: SignerContext, marketIndex: number, fraction: number, isolated: boolean, nonce: number) {
  const signer = await signerFor(context);
  return check(
    signer.SignUpdateLeverage(marketIndex, fraction, isolated ? 1 : 0, 0, nonce, context.apiKeyIndex, context.accountIndex),
    "SignUpdateLeverage",
  );
}

export async function signApproveIntegrator(
  context: SignerContext,
  integratorIndex: number,
  maxPerpsTakerFee: number,
  expiryMs: number,
  nonce: number,
) {
  const signer = await signerFor(context);
  return check(
    signer.SignApproveIntegrator(integratorIndex, maxPerpsTakerFee, 0, 0, 0, expiryMs, 0, nonce, context.apiKeyIndex, context.accountIndex),
    "SignApproveIntegrator",
  );
}

/** Adds the L1 wallet signature to a signed tx (ChangePubKey, ApproveIntegrator with fees). */
export function withL1Signature(tx: SignedTx, signature: string): SignedTx {
  return { ...tx, txInfo: JSON.stringify({ ...JSON.parse(tx.txInfo), L1Sig: signature }) };
}
