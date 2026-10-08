/**
 * EVM chains the swap card trades any token on (Ethereum, Base, Arbitrum, BNB Chain, HyperEVM, Polygon, Optimism,
 * Avalanche, Unichain, Monad, Robinhood Chain): Uniswap (where it trades) and the aggregators (0x, KyberSwap) quote
 * each swap and the largest output runs. Adding a chain is one entry here, its logo in `public/chains`, its viem chain
 * in the swap card and its name in each aggregator's chain map. Every address and service name below was checked
 * against the chain and the services (DefiLlama, DexScreener, GeckoTerminal) when added. Robinhood
 * Chain stock tokens keep their own path (Arcus vs Uniswap, `robinhood-sources.ts`). Pure: no viem here, so lists and refs stay
 * light on the first screen.
 */

export type EvmSwapChainKey = "ethereum" | "base" | "arbitrum" | "bsc" | "hyperevm" | "polygon" | "optimism" | "avalanche" | "unichain" | "monad" | "robinhood";

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
  pool: "eth" | "base" | "arbitrum" | "bsc" | "hyperevm" | "polygon_pos" | "optimism" | "avax" | "unichain" | "monad" | "robinhood";
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
  /** The native coin's name ("Ether", "BNB"); its symbol is the native pay token's. */
  nativeName: string;
  /** The wrapped native token (WETH, WBNB), which stands for the native coin where an ERC-20 address is needed. */
  wrapped: `0x${string}`;
  /** Native coin (wei) "Max" leaves for gas when selling the native coin. */
  gasReserve: bigint;
  /**
   * What a token is bought with (or sold into): the chain's dollar first (USDC; USDG on Robinhood; USDT on BNB Chain,
   * where it's the deepest), then the native coin.
   */
  pay: EvmSwapToken[];
}

/** The Trading API's address for a chain's native coin (ETH, or BNB on BNB Chain). */
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export const isNativeToken = (address: string) => address === NATIVE_TOKEN;

const eth: EvmSwapToken = { address: NATIVE_TOKEN, symbol: "ETH", decimals: 18 };

/** The chain's wrapped native token (WETH, WBNB), which stands for the native coin in pool charts and prices. */
export const wrappedNative = (chain: EvmSwapChain) => chain.pay.find((token) => sameAddress(token.address, chain.wrapped))!;

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
    nativeName: "Ether",
    wrapped: "0x4200000000000000000000000000000000000006",
    gasReserve: 300_000_000_000_000n,
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
    nativeName: "Ether",
    wrapped: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    gasReserve: 300_000_000_000_000n,
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
    nativeName: "Ether",
    wrapped: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    gasReserve: 5_000_000_000_000_000n,
    pay: [
      { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
      eth,
      { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
      { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
    ],
  },
  {
    // BNB Chain: most liquidity sits on PancakeSwap, which Uniswap's /tokens doesn't rank, so the busiest pools add
    // its tokens. Its USDT and USDC have 18 decimals.
    key: "bsc",
    id: 56,
    name: "BNB Chain",
    pool: "bsc",
    dexscreener: "bsc",
    llama: "bsc",
    explorer: "https://bscscan.com",
    rpc: "https://bsc-rpc.publicnode.com",
    poolTop: true,
    nativeName: "BNB",
    wrapped: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    gasReserve: 2_000_000_000_000_000n,
    pay: [
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", decimals: 18 },
      { address: NATIVE_TOKEN, symbol: "BNB", decimals: 18 },
      { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", symbol: "WBNB", decimals: 18 },
      { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", decimals: 18 },
    ],
  },
  {
    // Hyperliquid's EVM: no Uniswap here; the aggregators quote and its busiest pools list the tokens.
    key: "hyperevm",
    id: 999,
    name: "HyperEVM",
    pool: "hyperevm",
    dexscreener: "hyperevm",
    llama: "hyperliquid",
    explorer: "https://hyperevmscan.io",
    rpc: "https://rpc.hyperliquid.xyz/evm",
    poolTop: true,
    nativeName: "HYPE",
    wrapped: "0x5555555555555555555555555555555555555555",
    gasReserve: 5_000_000_000_000_000n,
    pay: [
      { address: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", symbol: "USDC", decimals: 6 },
      { address: NATIVE_TOKEN, symbol: "HYPE", decimals: 18 },
      { address: "0x5555555555555555555555555555555555555555", symbol: "WHYPE", decimals: 18 },
      { address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", symbol: "USDT0", decimals: 6 },
    ],
  },
  {
    key: "polygon",
    id: 137,
    name: "Polygon",
    pool: "polygon_pos",
    dexscreener: "polygon",
    llama: "polygon",
    explorer: "https://polygonscan.com",
    rpc: "https://polygon.drpc.org",
    nativeName: "POL",
    wrapped: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    gasReserve: 500_000_000_000_000_000n,
    pay: [
      { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", decimals: 6 },
      { address: NATIVE_TOKEN, symbol: "POL", decimals: 18 },
      { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", symbol: "WPOL", decimals: 18 },
      { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", decimals: 6 },
    ],
  },
  {
    key: "optimism",
    id: 10,
    name: "Optimism",
    pool: "optimism",
    dexscreener: "optimism",
    llama: "optimism",
    explorer: "https://optimistic.etherscan.io",
    rpc: "https://mainnet.optimism.io",
    nativeName: "Ether",
    wrapped: "0x4200000000000000000000000000000000000006",
    gasReserve: 200_000_000_000_000n,
    pay: [
      { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6 },
      eth,
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
      { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", symbol: "USDT", decimals: 6 },
    ],
  },
  {
    key: "avalanche",
    id: 43114,
    name: "Avalanche",
    pool: "avax",
    dexscreener: "avalanche",
    llama: "avax",
    explorer: "https://snowtrace.io",
    rpc: "https://api.avax.network/ext/bc/C/rpc",
    nativeName: "AVAX",
    wrapped: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    gasReserve: 20_000_000_000_000_000n,
    pay: [
      { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", symbol: "USDC", decimals: 6 },
      { address: NATIVE_TOKEN, symbol: "AVAX", decimals: 18 },
      { address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", symbol: "WAVAX", decimals: 18 },
      { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", symbol: "USDT", decimals: 6 },
    ],
  },
  {
    // Unichain's USDT is too thin to offer; USDC is its dollar.
    key: "unichain",
    id: 130,
    name: "Unichain",
    pool: "unichain",
    dexscreener: "unichain",
    llama: "unichain",
    explorer: "https://uniscan.xyz",
    rpc: "https://mainnet.unichain.org",
    nativeName: "Ether",
    wrapped: "0x4200000000000000000000000000000000000006",
    gasReserve: 200_000_000_000_000n,
    pay: [
      { address: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", symbol: "USDC", decimals: 6 },
      eth,
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
    ],
  },
  {
    key: "monad",
    id: 143,
    name: "Monad",
    pool: "monad",
    dexscreener: "monad",
    llama: "monad",
    explorer: "https://monadscan.com",
    rpc: "https://rpc.monad.xyz",
    poolTop: true,
    nativeName: "MON",
    wrapped: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
    gasReserve: 1_000_000_000_000_000_000n,
    pay: [
      { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", symbol: "USDC", decimals: 6 },
      { address: NATIVE_TOKEN, symbol: "MON", decimals: 18 },
      { address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", symbol: "WMON", decimals: 18 },
      { address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", symbol: "USDT0", decimals: 6 },
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
    nativeName: "Ether",
    wrapped: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    gasReserve: 300_000_000_000_000n,
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
