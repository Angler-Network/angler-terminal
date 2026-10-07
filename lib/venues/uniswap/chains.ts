/**
 * EVM chains the swap card trades any token on through Uniswap (Ethereum, Base, Arbitrum, Robinhood Chain). Robinhood
 * Chain stock tokens keep their own path (Arcus vs Uniswap, `robinhood-sources.ts`). Pure: no viem here, so lists and refs stay
 * light on the first screen.
 */

export type EvmSwapChainKey = "ethereum" | "base" | "arbitrum" | "robinhood";

export interface EvmSwapToken {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface EvmSwapChain {
  key: EvmSwapChainKey;
  id: number;
  name: string;
  /** GeckoTerminal network id (pool candles, trades). */
  pool: "eth" | "base" | "arbitrum" | "robinhood";
  /**
   * Also list the tokens of the chain's busiest pools (GeckoTerminal), for chains Uniswap's `/tokens` may not rank
   * (Robinhood). Arcus's stock tokens are listed once, as Arcus.
   */
  poolTop?: boolean;
  /** DexScreener chain id (volume, liquidity, search). */
  dexscreener: string;
  /** DefiLlama chain name (prices). */
  llama: string;
  explorer: string;
  rpc: string;
  /** What a token is bought with (or sold into): the chain's dollar first (USDC, USDG on Robinhood), then native ETH. */
  pay: EvmSwapToken[];
}

/** The Trading API's address for a chain's native coin (ETH on all three chains). */
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export const isNativeToken = (address: string) => address === NATIVE_TOKEN;

const eth: EvmSwapToken = { address: NATIVE_TOKEN, symbol: "ETH", decimals: 18 };

/** The chain's WETH, which stands for ETH where an ERC-20 address is needed (pool charts, prices). */
export const wrappedNative = (chain: EvmSwapChain) => chain.pay.find((token) => token.symbol === "WETH")!;

export const EVM_SWAP_CHAINS: EvmSwapChain[] = [
  {
    key: "base",
    id: 8453,
    name: "Base",
    pool: "base",
    dexscreener: "base",
    llama: "base",
    explorer: "https://basescan.org",
    rpc: "https://mainnet.base.org",
    pay: [
      { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
      eth,
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
      { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", symbol: "USDT", decimals: 6 },
    ],
  },
  {
    key: "arbitrum",
    id: 42161,
    name: "Arbitrum",
    pool: "arbitrum",
    dexscreener: "arbitrum",
    llama: "arbitrum",
    explorer: "https://arbiscan.io",
    rpc: "https://arb1.arbitrum.io/rpc",
    pay: [
      { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6 },
      eth,
      { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", symbol: "WETH", decimals: 18 },
      { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", decimals: 6 },
    ],
  },
  {
    key: "ethereum",
    id: 1,
    name: "Ethereum",
    pool: "eth",
    dexscreener: "ethereum",
    llama: "ethereum",
    explorer: "https://etherscan.io",
    rpc: "https://ethereum-rpc.publicnode.com",
    pay: [
      { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
      eth,
      { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
      { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
    ],
  },
  {
    key: "robinhood",
    id: 4663,
    name: "Robinhood Chain",
    pool: "robinhood",
    dexscreener: "robinhood",
    llama: "robinhood",
    explorer: "https://robinhoodchain.blockscout.com",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    poolTop: true,
    pay: [
      { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG", decimals: 6 },
      eth,
      { address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", symbol: "WETH", decimals: 18 },
    ],
  },
];

export function evmSwapChain(id: number | undefined) {
  return EVM_SWAP_CHAINS.find((chain) => chain.id === id) ?? null;
}

export function evmSwapChainByDexscreener(id: string) {
  return EVM_SWAP_CHAINS.find((chain) => chain.dexscreener === id) ?? null;
}

const EVM_REF = /^evm:(\d+):(0x[0-9a-fA-F]{40})$/;

/**
 * An EVM token travels through the selected asset's `mint` slot (and the watchlist) as "evm:<chainId>:<address>":
 * Solana mints never contain ":", so every Jupiter lookup can tell the two apart.
 */
export function evmRef(chainId: number, address: string) {
  return `evm:${chainId}:${address}`;
}

export function parseEvmRef(value: string | undefined | null): { chain: EvmSwapChain; address: `0x${string}` } | null {
  const match = value ? EVM_REF.exec(value) : null;
  const chain = match ? evmSwapChain(Number(match[1])) : null;
  return match && chain ? { chain, address: match[2] as `0x${string}` } : null;
}

export const isEvmRef = (value: string | undefined | null) => Boolean(value?.startsWith("evm:"));

export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
