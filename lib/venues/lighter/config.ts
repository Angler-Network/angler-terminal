/**
 * Lighter settings from public env vars. Switching network is a config change only:
 * NEXT_PUBLIC_LIGHTER_NETWORK=testnet (default) or mainnet. Docs: https://apidocs.lighter.xyz (index: /llms.txt).
 */

import { deployment, pinnedNetwork } from "@/lib/deployment";

export type LighterNetwork = "mainnet" | "testnet";

const HOSTS: Record<LighterNetwork, string> = {
  mainnet: "mainnet.zklighter.elliot.ai",
  testnet: "testnet.zklighter.elliot.ai",
};

/** Signing chain ids. A transaction signed for one network is rejected by the other. */
export const CHAIN_IDS: Record<LighterNetwork, number> = { mainnet: 304, testnet: 300 };

export const APP_URLS: Record<LighterNetwork, string> = {
  mainnet: "https://app.lighter.xyz",
  testnet: "https://testnet.app.lighter.xyz",
};

/** API key indexes 0-3 belong to Lighter's own apps; 255 means "all keys" in queries. */
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
  network: LighterNetwork;
  isTestnet: boolean;
  apiUrl: string;
  wsUrl: string;
  chainId: number;
  appUrl: string;
  apiKeyIndex: number;
  /** Partner attribution; null when NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT is unset. */
  integrator: LighterIntegrator | null;
  /** Our Lighter referral code (NEXT_PUBLIC_LIGHTER_REFERRAL_CODE), offered during setup; null when unset. */
  referralCode: string | null;
}

export function readLighterConfig(env: Record<string, string | undefined>): LighterConfig {
  const network = readLighterNetwork(env.NEXT_PUBLIC_LIGHTER_NETWORK);
  const host = HOSTS[network];
  const account = readInteger(env.NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT, 1, 2 ** 48 - 1);
  const takerFee = readInteger(env.NEXT_PUBLIC_LIGHTER_INTEGRATOR_FEE, 0, MAX_PERP_INTEGRATOR_FEE) ?? 0;
  const maxTakerFee = Math.max(takerFee, readInteger(env.NEXT_PUBLIC_LIGHTER_MAX_INTEGRATOR_FEE, 0, MAX_PERP_INTEGRATOR_FEE) ?? takerFee);
  return {
    network,
    isTestnet: network === "testnet",
    apiUrl: `https://${host}`,
    wsUrl: `wss://${host}/stream`,
    chainId: CHAIN_IDS[network],
    appUrl: APP_URLS[network],
    apiKeyIndex: readInteger(env.NEXT_PUBLIC_LIGHTER_API_KEY_INDEX, MIN_API_KEY_INDEX, MAX_API_KEY_INDEX) ?? DEFAULT_API_KEY_INDEX,
    integrator: account ? { accountIndex: account, takerFee, maxTakerFee } : null,
    referralCode: /^[A-Za-z0-9_-]{1,32}$/.test(env.NEXT_PUBLIC_LIGHTER_REFERRAL_CODE?.trim() ?? "") ? env.NEXT_PUBLIC_LIGHTER_REFERRAL_CODE!.trim() : null,
  };
}

/** Per-browser network choice from Settings; overrides NEXT_PUBLIC_LIGHTER_NETWORK and applies after a reload. */
export const LIGHTER_NETWORK_OVERRIDE_KEY = "angler-terminal:lighter-network";

export const defaultLighterNetwork = readLighterNetwork(pinnedNetwork(deployment, undefined, process.env.NEXT_PUBLIC_LIGHTER_NETWORK));

function readNetworkOverride(): LighterNetwork | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(LIGHTER_NETWORK_OVERRIDE_KEY);
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
