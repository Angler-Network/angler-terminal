/**
 * Hyperliquid settings from public env vars. Switching network is a config change only:
 * NEXT_PUBLIC_HL_NETWORK=testnet (default) or mainnet.
 */

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

function readNetwork(value: string | undefined): HlNetwork {
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
  isTestnet: boolean;
  apiUrl: string;
  builder: { address: `0x${string}`; fee: number; maxFee: number } | null;
}

export function readHlConfig(env: Record<string, string | undefined>): HlConfig {
  const network = readNetwork(env.NEXT_PUBLIC_HL_NETWORK);
  const address = readAddress(env.NEXT_PUBLIC_HL_BUILDER_ADDRESS);
  const fee = readFee(env.NEXT_PUBLIC_HL_BUILDER_FEE, 0);
  const maxFee = Math.max(fee, readFee(env.NEXT_PUBLIC_HL_MAX_BUILDER_FEE, fee));
  return {
    network,
    isTestnet: network === "testnet",
    apiUrl: API_URLS[network],
    builder: address ? { address, fee, maxFee } : null,
  };
}

// Next.js inlines NEXT_PUBLIC_* only when accessed by their full name.
export const hlConfig = readHlConfig({
  NEXT_PUBLIC_HL_NETWORK: process.env.NEXT_PUBLIC_HL_NETWORK,
  NEXT_PUBLIC_HL_BUILDER_ADDRESS: process.env.NEXT_PUBLIC_HL_BUILDER_ADDRESS,
  NEXT_PUBLIC_HL_BUILDER_FEE: process.env.NEXT_PUBLIC_HL_BUILDER_FEE,
  NEXT_PUBLIC_HL_MAX_BUILDER_FEE: process.env.NEXT_PUBLIC_HL_MAX_BUILDER_FEE,
});

/** approveBuilderFee takes a percent string: 1 tenth-bps = 0.001%, so 10 → "0.01%". */
export function feeToPercent(tenthsOfBps: number) {
  return `${Number((tenthsOfBps / 1000).toFixed(3))}%`;
}
