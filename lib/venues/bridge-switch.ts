/**
 * Which bridges may quote: the trader's switches in Settings minus any an admin turned off for everyone (a hacked or
 * failing bridge). Off ones are never even asked for a quote. Kept apart from `bridge-leg.ts` so the app shell can
 * set it without loading the bridge clients.
 */
export type BridgeProvider = "across" | "relay" | "lifi";

export const PROVIDERS: BridgeProvider[] = ["across", "relay", "lifi"];

let enabledProviders = new Set<BridgeProvider>(PROVIDERS);

export function setEnabledBridges(providers: BridgeProvider[]) {
  enabledProviders = new Set(providers);
}

export function bridgeEnabled(provider: BridgeProvider) {
  return enabledProviders.has(provider);
}
