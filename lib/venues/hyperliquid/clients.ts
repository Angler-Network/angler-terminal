import type { ExchangeClient, HttpTransport, InfoClient, SubscriptionClient } from "@nktkas/hyperliquid";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { hlConfig } from "./config";

/**
 * The SDK (and viem's signer) load on first use, not with the page: the terminal only needs them once a wallet is
 * connected or an order is placed.
 */
const sdk = () => import("@nktkas/hyperliquid");

let http: Promise<HttpTransport> | null = null;
let info: Promise<InfoClient> | null = null;
let subscriptions: Promise<SubscriptionClient> | null = null;

function httpTransport() {
  http ??= sdk().then(({ HttpTransport }) => new HttpTransport({ isTestnet: hlConfig.isTestnet, apiUrl: hlConfig.apiUrl }));
  return http;
}

export function infoClient() {
  info ??= Promise.all([sdk(), httpTransport()]).then(([{ InfoClient }, transport]) => new InfoClient({ transport }));
  return info;
}

/** One socket per tab, opened from the browser so each user spends their own rate limit. */
export function subscriptionClient() {
  subscriptions ??= sdk().then(
    ({ SubscriptionClient, WebSocketTransport }) => new SubscriptionClient({ transport: new WebSocketTransport({ isTestnet: hlConfig.isTestnet }) }),
  );
  return subscriptions;
}

/** Exchange client signing with the user's own wallet (approvals). */
export async function userExchange(wallet: AbstractWallet): Promise<ExchangeClient> {
  const [{ ExchangeClient }, transport] = await Promise.all([sdk(), httpTransport()]);
  return new ExchangeClient({ transport, wallet });
}

/** Exchange client signing locally with the agent key (orders, cancels, leverage). */
export async function agentExchange(privateKey: `0x${string}`): Promise<ExchangeClient> {
  const [{ ExchangeClient }, transport, { privateKeyToAccount }] = await Promise.all([sdk(), httpTransport(), import("viem/accounts")]);
  return new ExchangeClient({ transport, wallet: privateKeyToAccount(privateKey) });
}
