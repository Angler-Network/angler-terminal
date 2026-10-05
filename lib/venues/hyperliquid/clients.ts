import { ExchangeClient, HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { hlConfig } from "./config";

let http: HttpTransport | null = null;
let ws: WebSocketTransport | null = null;
let info: InfoClient | null = null;
let subscriptions: SubscriptionClient | null = null;

function httpTransport() {
  http ??= new HttpTransport({ isTestnet: hlConfig.isTestnet, apiUrl: hlConfig.apiUrl });
  return http;
}

export function infoClient() {
  info ??= new InfoClient({ transport: httpTransport() });
  return info;
}

/** One socket per tab, opened from the browser so each user spends their own rate limit. */
export function subscriptionClient() {
  if (!subscriptions) {
    ws = new WebSocketTransport({ isTestnet: hlConfig.isTestnet });
    subscriptions = new SubscriptionClient({ transport: ws });
  }
  return subscriptions;
}

/** Exchange client signing with the user's own wallet (approvals). */
export function userExchange(wallet: AbstractWallet) {
  return new ExchangeClient({ transport: httpTransport(), wallet });
}

/** Exchange client signing locally with the agent key (orders, cancels, leverage). */
export function agentExchange(privateKey: `0x${string}`) {
  return new ExchangeClient({ transport: httpTransport(), wallet: privateKeyToAccount(privateKey) });
}
