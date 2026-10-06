/**
 * Hyperliquid settings from public env vars. Switching network is a config change only:
 * NEXT_PUBLIC_HL_NETWORK=testnet (default) or mainnet.
 */

import { deployment, pinnedNetwork } from "@/lib/deployment";

export type HlNetwork = "mainnet" | "testnet";

const API_URLS: Record<HlNetwork, string> = {
  mainnet: "https://api.hyperliquid.xyz",
  testnet: "https://api.hyperliquid-testnet.xyz",
};

/** Builder fee unit is a tenth of a basis point. Perps allow at most 100 (0.1%). */
export const MAX_PERP_BUILDER_FEE = 100;

/** Agent name shown in Hyperliquid's API wallet list; re-approving the same name replaces the old agent. */
export const AGENT_NAME = "angler terminal";

export const DEFAULT_SLIPPAGE = 0.05;

export function readNetwork(value: string | null | undefined): HlNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

function readFee(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(MAX_PERP_BUILDER_FEE, number) : fallback;
}

function readAddress(value: string | undefined) {
  // The zero address is the .env.example placeholder, never a real builder.
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/.test(value) ? (value.toLowerCase() as `0x${string}`) : null;
}

export interface HlConfig {
  network: HlNetwork;
  /**
   * HIP-3 dexs the terminal lists. Testnet has hundreds of builder-deployed dexs (many junk), mainnet has several
   * products; default to xyz, where Hyperliquid's equity perps live.
   */
  hip3Dexes: string[];
  isTestnet: boolean;
  apiUrl: string;
  builder: { address: `0x${string}`; fee: number; maxFee: number } | null;
}

export function readHlConfig(env: Record<string, string | undefined>): HlConfig {
  const network = readNetwork(env.NEXT_PUBLIC_HL_NETWORK);
  const address = readAddress(env.NEXT_PUBLIC_HL_BUILDER_ADDRESS);
  const fee = readFee(env.NEXT_PUBLIC_HL_BUILDER_FEE, 0);
  const maxFee = Math.max(fee, readFee(env.NEXT_PUBLIC_HL_MAX_BUILDER_FEE, fee));
  const hip3Dexes = (env.NEXT_PUBLIC_HL_HIP3_DEXES ?? "xyz")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[A-Za-z0-9<>_-]{1,20}$/.test(name));
  return {
    network,
    hip3Dexes,
    isTestnet: network === "testnet",
    apiUrl: API_URLS[network],
    builder: address ? { address, fee, maxFee } : null,
  };
}

/** Per-browser network choice from Settings; overrides NEXT_PUBLIC_HL_NETWORK and applies after a reload. */
export const HL_NETWORK_OVERRIDE_KEY = "angler-terminal:hl-network";

export const defaultHlNetwork = readNetwork(pinnedNetwork(deployment, undefined, process.env.NEXT_PUBLIC_HL_NETWORK));

function readNetworkOverride(): HlNetwork | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(HL_NETWORK_OVERRIDE_KEY);
    return value === "mainnet" || value === "testnet" ? value : undefined;
  } catch {
    return undefined;
  }
}

// Next.js inlines NEXT_PUBLIC_* only when accessed by their full name.
export const hlConfig = readHlConfig({
  NEXT_PUBLIC_HL_NETWORK: pinnedNetwork(deployment, readNetworkOverride(), process.env.NEXT_PUBLIC_HL_NETWORK),
  NEXT_PUBLIC_HL_BUILDER_ADDRESS: process.env.NEXT_PUBLIC_HL_BUILDER_ADDRESS,
  NEXT_PUBLIC_HL_BUILDER_FEE: process.env.NEXT_PUBLIC_HL_BUILDER_FEE,
  NEXT_PUBLIC_HL_MAX_BUILDER_FEE: process.env.NEXT_PUBLIC_HL_MAX_BUILDER_FEE,
  NEXT_PUBLIC_HL_HIP3_DEXES: process.env.NEXT_PUBLIC_HL_HIP3_DEXES,
});

/** approveBuilderFee takes a percent string: 1 tenth-bps = 0.001%, so 10 → "0.01%". */
export function feeToPercent(tenthsOfBps: number) {
  return `${Number((tenthsOfBps / 1000).toFixed(3))}%`;
}
