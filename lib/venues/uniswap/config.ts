/**
 * Uniswap Trading API (trade-api.gateway.uniswap.org, docs developers.uniswap.org/docs/trading/swapping-api). Every
 * call goes through /api/uniswap, which adds the API key and our integrator fee; neither reaches the browser. There is
 * no testnet: the terminal uses it on mainnet only.
 */

export const UNISWAP_API_URL = "https://trade-api.gateway.uniswap.org/v1";

/** Chains the terminal quotes on: Robinhood Chain (stock tokens) and the EVM swap chains (`chains.ts`). */
export const UNISWAP_CHAIN_IDS = [4663, 1, 8453, 42161, 56, 137, 10, 43114, 130, 143] as const;

/** The API's cap on the integrator fee (summed over recipients), in bps. */
export const UNISWAP_MAX_FEE_BPS = 500;

/** Quotes older than this are fetched again before signing (the API's own advice is 30 seconds). */
export const UNISWAP_QUOTE_TTL_MS = 25_000;

/** Stands in for the swapper on price-only quotes before a wallet connects (the API requires one). */
export const QUOTE_ONLY_SWAPPER = "0x000000000000000000000000000000000000dEaD";

export const UNISWAP_APP_URL = "https://app.uniswap.org";
