/**
 * Four.meme, BNB Chain's memecoin launchpad. Its tokens are deployed at vanity addresses ending in 4444 (launched against
 * BNB or USDT) or ffff (against other quote tokens); GeckoTerminal lists their bonding-curve pools under the dex
 * "four-meme", and graduated ones trade on PancakeSwap. KyberSwap doesn't route curve tokens ("token not found"); LI.FI
 * does (through OKX's aggregator, with our fee), so the EVM swap card asks LI.FI too for these tokens.
 */

export const FOUR_MEME_CHAIN_ID = 56;
const FOUR_MEME_ADDRESS = /^0x[0-9a-f]{36}(?:4444|ffff)$/i;

export function isFourMemeAddress(chainId: number, address: string | null | undefined) {
  return chainId === FOUR_MEME_CHAIN_ID && Boolean(address && FOUR_MEME_ADDRESS.test(address));
}
