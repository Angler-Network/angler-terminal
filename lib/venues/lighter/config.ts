/**
 * Lighter settings from public env vars. Switching network is a config change only:
 * NEXT_PUBLIC_LIGHTER_NETWORK=testnet (default) or mainnet. Docs: https://apidocs.lighter.xyz (index: /llms.txt).
 *
 * Lighter runs two separate exchanges with the same transaction format, signer, REST API and WebSocket channels:
 * "core" (settles on Ethereum, USDC) and "rh", Lighter on Robinhood Chain (USDG; docs apidocs.rh.lighter.xyz).
 * Accounts, keys, nonces and account indexes don't carry over, and a transaction signed for one is rejected by the
 * other, so every module takes the instance's config: base URL and chain id always travel together.
 */

import { deployment, pinnedNetwork } from "@/lib/deployment";

export type LighterNetwork = "mainnet" | "testnet";
export type LighterInstance = "core" | "rh";
/** The perp venue id each instance trades as. */
export type LighterVenueId = "lighter" | "lighterRh";

const HOSTS: Record<LighterInstance, Record<LighterNetwork, string>> = {
  core: { mainnet: "mainnet.zklighter.elliot.ai", testnet: "testnet.zklighter.elliot.ai" },
  rh: { mainnet: "api.rh.lighter.xyz", testnet: "api.rh-testnet.lighter.xyz" },
};

/** Signing chain ids. A transaction signed for one network (or instance) is rejected by the others. */
export const CHAIN_IDS: Record<LighterInstance, Record<LighterNetwork, number>> = {
  core: { mainnet: 304, testnet: 300 },
  rh: { mainnet: 466_324, testnet: 300 },
};

/** Lighter's own web app; Lighter on Robinhood is traded from the Robinhood Wallet app, so it has none. */
export const APP_URLS: Record<LighterInstance, Record<LighterNetwork, string | null>> = {
  core: { mainnet: "https://app.lighter.xyz", testnet: "https://testnet.app.lighter.xyz" },
  rh: { mainnet: null, testnet: null },
};

/** Lighter on Robinhood takes USDG on Robinhood Chain (asset 3 in `assetDetails`, 6 decimals). */
export const RH_USDG: Record<LighterNetwork, `0x${string}`> = {
  mainnet: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  testnet: "0xF694Db2716e30d3e063AaC05DeBbb2140e036220",
};
export const ROBINHOOD_CHAIN_IDS: Record<LighterNetwork, number> = { mainnet: 4663, testnet: 46630 };

/** API key indexes 0-3 (and 157 on Robinhood) belong to Lighter's own apps; 255 means "all keys" in queries. */
export const MIN_API_KEY_INDEX = 4;
export const MAX_API_KEY_INDEX = 254;
/**
 * Registering a key replaces whatever key sits at that index, so the terminal uses its own index instead of the
 * commonly used 4 to avoid logging the user out of another app.
 */
export const DEFAULT_API_KEY_INDEX = 61;

/** Integrator fees are in millionths of the trade size (1000 = 10 bps). The testnet system cap is 10000 for perps. */
export const MAX_PERP_INTEGRATOR_FEE = 10_000;

/** Worst acceptable price for market orders: best bid/ask moved this far against the order. */
export const DEFAULT_SLIPPAGE = 0.03;

export function readLighterNetwork(value: string | null | undefined): LighterNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

function readInteger(value: string | undefined, min: number, max: number) {
  const number = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export interface LighterIntegrator {
  /** Partner account index that collects the fees. */
  accountIndex: number;
  /** Fee charged per taker order, millionths of the trade size. */
  takerFee: number;
  /** Max fee the user approves (at least takerFee). */
  maxTakerFee: number;
}

export interface LighterConfig {
  instance: LighterInstance;
  venue: LighterVenueId;
  /** "Lighter" or "Lighter RH", for messages. */
  name: string;
  /** The margin token: USDC on core, USDG on Robinhood. */
  collateral: "USDC" | "USDG";
  /** Prefix for this instance's browser storage and caches (core keeps the bare network, as before). */
  storeKey: string;
  network: LighterNetwork;
  isTestnet: boolean;
  apiUrl: string;
  wsUrl: string;
  chainId: number;
  appUrl: string | null;
  apiKeyIndex: number;
  /** Partner attribution; null when NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT is unset. */
  integrator: LighterIntegrator | null;
  /** Our Lighter referral code (NEXT_PUBLIC_LIGHTER_REFERRAL_CODE), offered during setup; null when unset. */
  referralCode: string | null;
}

/**
 * One instance's settings. Both instances read the same variable names; the Robinhood instance's are mapped from
 * NEXT_PUBLIC_LIGHTER_RH_* (see `lighterRhConfig`).
 */
export function readLighterConfig(env: Record<string, string | undefined>, instance: LighterInstance = "core"): LighterConfig {
  const network = readLighterNetwork(env.NEXT_PUBLIC_LIGHTER_NETWORK);
  const host = HOSTS[instance][network];
  const apiKeyIndex = readInteger(env.NEXT_PUBLIC_LIGHTER_API_KEY_INDEX, MIN_API_KEY_INDEX, MAX_API_KEY_INDEX);
  const account = readInteger(env.NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT, 1, 2 ** 48 - 1);
  const takerFee = readInteger(env.NEXT_PUBLIC_LIGHTER_INTEGRATOR_FEE, 0, MAX_PERP_INTEGRATOR_FEE) ?? 0;
  const maxTakerFee = Math.max(takerFee, readInteger(env.NEXT_PUBLIC_LIGHTER_MAX_INTEGRATOR_FEE, 0, MAX_PERP_INTEGRATOR_FEE) ?? takerFee);
  return {
    instance,
    venue: instance === "rh" ? "lighterRh" : "lighter",
    name: instance === "rh" ? "Lighter RH" : "Lighter",
    collateral: instance === "rh" ? "USDG" : "USDC",
    storeKey: instance === "rh" ? `rh-${network}` : network,
    network,
    isTestnet: network === "testnet",
    apiUrl: `https://${host}`,
    wsUrl: `wss://${host}/stream`,
    chainId: CHAIN_IDS[instance][network],
    appUrl: APP_URLS[instance][network],
    // Robinhood reserves index 157 for its own apps.
    apiKeyIndex: apiKeyIndex !== null && !(instance === "rh" && apiKeyIndex === 157) ? apiKeyIndex : DEFAULT_API_KEY_INDEX,
    integrator: account ? { accountIndex: account, takerFee, maxTakerFee } : null,
    referralCode: /^[A-Za-z0-9_-]{1,32}$/.test(env.NEXT_PUBLIC_LIGHTER_REFERRAL_CODE?.trim() ?? "") ? env.NEXT_PUBLIC_LIGHTER_REFERRAL_CODE!.trim() : null,
  };
}

/** Per-browser network choice from Settings; overrides NEXT_PUBLIC_LIGHTER_NETWORK and applies after a reload. */
export const LIGHTER_NETWORK_OVERRIDE_KEY = "angler-terminal:lighter-network";
export const LIGHTER_RH_NETWORK_OVERRIDE_KEY = "angler-terminal:lighter-rh-network";

export const defaultLighterNetwork = readLighterNetwork(pinnedNetwork(deployment, undefined, process.env.NEXT_PUBLIC_LIGHTER_NETWORK));

export const defaultLighterRhNetwork = readLighterNetwork(pinnedNetwork(deployment, undefined, process.env.NEXT_PUBLIC_LIGHTER_RH_NETWORK));

function readNetworkOverride(key = LIGHTER_NETWORK_OVERRIDE_KEY): LighterNetwork | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(key);
    return value === "mainnet" || value === "testnet" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Candle resolutions Lighter's `candles` endpoint serves. */
export const LIGHTER_CANDLE_RESOLUTIONS: ReadonlySet<string> = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d"]);

// Next.js inlines NEXT_PUBLIC_* only when accessed by their full name.
export const lighterConfig = readLighterConfig({
  NEXT_PUBLIC_LIGHTER_NETWORK: pinnedNetwork(deployment, readNetworkOverride(), process.env.NEXT_PUBLIC_LIGHTER_NETWORK),
  NEXT_PUBLIC_LIGHTER_API_KEY_INDEX: process.env.NEXT_PUBLIC_LIGHTER_API_KEY_INDEX,
  NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT: process.env.NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT,
  NEXT_PUBLIC_LIGHTER_INTEGRATOR_FEE: process.env.NEXT_PUBLIC_LIGHTER_INTEGRATOR_FEE,
  NEXT_PUBLIC_LIGHTER_MAX_INTEGRATOR_FEE: process.env.NEXT_PUBLIC_LIGHTER_MAX_INTEGRATOR_FEE,
  NEXT_PUBLIC_LIGHTER_REFERRAL_CODE: process.env.NEXT_PUBLIC_LIGHTER_REFERRAL_CODE,
});

/** Lighter on Robinhood Chain: NEXT_PUBLIC_LIGHTER_RH_* (network, integrator, referral code); the key index is shared. */
export const lighterRhConfig = readLighterConfig(
  {
    NEXT_PUBLIC_LIGHTER_NETWORK: pinnedNetwork(deployment, readNetworkOverride(LIGHTER_RH_NETWORK_OVERRIDE_KEY), process.env.NEXT_PUBLIC_LIGHTER_RH_NETWORK),
    NEXT_PUBLIC_LIGHTER_API_KEY_INDEX: process.env.NEXT_PUBLIC_LIGHTER_API_KEY_INDEX,
    NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT: process.env.NEXT_PUBLIC_LIGHTER_RH_INTEGRATOR_ACCOUNT,
    NEXT_PUBLIC_LIGHTER_INTEGRATOR_FEE: process.env.NEXT_PUBLIC_LIGHTER_RH_INTEGRATOR_FEE,
    NEXT_PUBLIC_LIGHTER_MAX_INTEGRATOR_FEE: process.env.NEXT_PUBLIC_LIGHTER_RH_MAX_INTEGRATOR_FEE,
    NEXT_PUBLIC_LIGHTER_REFERRAL_CODE: process.env.NEXT_PUBLIC_LIGHTER_RH_REFERRAL_CODE,
  },
  "rh",
);

export const lighterConfigs: Record<LighterVenueId, LighterConfig> = { lighter: lighterConfig, lighterRh: lighterRhConfig };

export function isLighterVenue(venue: string): venue is LighterVenueId {
  return venue === "lighter" || venue === "lighterRh";
}
