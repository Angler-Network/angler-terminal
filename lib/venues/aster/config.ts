/**
 * Aster perps (asterdex.com, API docs github.com/asterdex/api-docs, "V3"): Binance-style REST at fapi.asterdex.com,
 * signed with EIP-712. Two kinds of signature (from Aster's own demo, demo/aster-code.py):
 * - the wallet signs account actions (approve an agent, approve our builder fee) as typed data on chain 56;
 * - the agent key, made in this browser, signs every order and query as a `Message { msg }` on Aster's chain 1666.
 * Mainnet only; the builder (our fee address) comes from NEXT_PUBLIC_ASTER_BUILDER.
 */

export const ASTER_API_URL = "https://fapi.asterdex.com";
export const ASTER_APP_URL = "https://www.asterdex.com/en/futures/v2/BTCUSDT";

/** Domain chain of the wallet's typed-data signatures (`signatureChainId`), and of the agent's. */
export const ASTER_WALLET_SIGN_CHAIN = 56;
export const ASTER_AGENT_SIGN_CHAIN = 1666;
export const ASTER_CHAIN_NAME = "Mainnet";

/** Aster caps the futures builder fee at 0.1%. */
export const ASTER_MAX_BUILDER_FEE = 0.001;

export interface AsterBuilder {
  address: `0x${string}`;
  /** Fee rate per fill as a fraction (0.00035 = 3.5 bps), and the cap users approve once. */
  feeRate: number;
  maxFeeRate: number;
}

function readRate(value: string | undefined) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= ASTER_MAX_BUILDER_FEE ? rate : null;
}

export function readAsterConfig(env: Record<string, string | undefined>) {
  const address = env.NEXT_PUBLIC_ASTER_BUILDER?.trim() ?? "";
  const feeRate = readRate(env.NEXT_PUBLIC_ASTER_BUILDER_FEE);
  const maxFeeRate = Math.max(feeRate ?? 0, readRate(env.NEXT_PUBLIC_ASTER_MAX_BUILDER_FEE) ?? 0);
  const builder: AsterBuilder | null = /^0x[0-9a-fA-F]{40}$/.test(address) && feeRate ? { address: address as `0x${string}`, feeRate, maxFeeRate } : null;
  return { network: "mainnet" as const, apiUrl: ASTER_API_URL, builder };
}

export const asterConfig = readAsterConfig({
  NEXT_PUBLIC_ASTER_BUILDER: process.env.NEXT_PUBLIC_ASTER_BUILDER,
  NEXT_PUBLIC_ASTER_BUILDER_FEE: process.env.NEXT_PUBLIC_ASTER_BUILDER_FEE,
  NEXT_PUBLIC_ASTER_MAX_BUILDER_FEE: process.env.NEXT_PUBLIC_ASTER_MAX_BUILDER_FEE,
});
