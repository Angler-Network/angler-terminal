/** Jupiter Swap V2 (https://api.jup.ag/swap/v2) settings. Everything here is server-side except the presets. */

export const JUP_API_URL = "https://api.jup.ag";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Jupiter's documented referralFee range for /swap/v2/order, in bps. */
export const MIN_REFERRAL_FEE_BPS = 50;
export const MAX_REFERRAL_FEE_BPS = 255;

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaAddress(value: unknown): value is string {
  return typeof value === "string" && BASE58_ADDRESS.test(value);
}

export interface JupServerConfig {
  apiKey: string | null;
  /** Both set, or neither: Jupiter requires referralAccount and referralFee together. */
  referral: { account: string; feeBps: number } | null;
  rpcUrl: string;
}

export function readJupServerConfig(env: Record<string, string | undefined>): JupServerConfig {
  const apiKey = env.JUP_API_KEY?.trim() || null;
  const account = env.JUP_REFERRAL_ACCOUNT?.trim();
  const fee = Number(env.JUP_REFERRAL_FEE_BPS);
  const referral =
    isSolanaAddress(account) && Number.isInteger(fee) && fee >= MIN_REFERRAL_FEE_BPS && fee <= MAX_REFERRAL_FEE_BPS
      ? { account, feeBps: fee }
      : null;
  return { apiKey, referral, rpcUrl: env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com" };
}

/**
 * USD size presets for the spot panel. Development defaults to tiny sizes because Jupiter has no testnet and
 * tests run with real funds.
 */
export function spotSizePresets(env: { NODE_ENV?: string; NEXT_PUBLIC_SPOT_SIZE_PRESETS?: string }) {
  const custom = (env.NEXT_PUBLIC_SPOT_SIZE_PRESETS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (custom.length > 0) return custom.slice(0, 4);
  return env.NODE_ENV === "production" ? [25, 100, 250, 1000] : [1, 2, 5];
}

export const SOLSCAN_TX_URL = "https://solscan.io/tx/";
export const SOLSCAN_TOKEN_URL = "https://solscan.io/token/";
