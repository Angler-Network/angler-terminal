import type { Chain } from "viem";
import { deployment, pinnedNetwork } from "@/lib/deployment";

/**
 * Arcus spot (stock tokens on Robinhood Chain) settings from public env vars. Switching network is a config change
 * only: NEXT_PUBLIC_ARCUS_NETWORK=testnet (default) or mainnet. Docs: https://docs.arcus.xyz, router API reference at
 * {router}/llms.txt.
 */

export type ArcusNetwork = "mainnet" | "testnet";

export const ROUTER_URLS: Record<ArcusNetwork, string> = {
  mainnet: "https://router.spot.arcus.xyz",
  testnet: "https://router.spot.testnet.arcus.xyz",
};

export const CHAIN_IDS: Record<ArcusNetwork, number> = { mainnet: 4663, testnet: 46630 };

/** Stablecoin trades are sized in: USDG on mainnet, the mock mUSDG on testnet. */
export const QUOTE_SYMBOLS: Record<ArcusNetwork, string> = { mainnet: "USDG", testnet: "mUSDG" };

/** Slippage bound signed into every order (the router's minBuyAmount). */
export const ARCUS_SLIPPAGE_BPS = 50;

/** The router rejects trades under about $5 notional (TRADE_NOTIONAL_BELOW_MINIMUM). */
export const ARCUS_MIN_NOTIONAL_USD = 5;

export function readArcusNetwork(value: string | null | undefined): ArcusNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

/** Robinhood Chain for viem. Mainnet has no documented public RPC, so NEXT_PUBLIC_ARCUS_RPC_URL can set one. */
export function robinhoodChain(network: ArcusNetwork, rpcUrl?: string) {
  const isTestnet = network === "testnet";
  const rpc = rpcUrl || (isTestnet ? "https://rpc.testnet.chain.robinhood.com" : "https://rpc.chain.robinhood.com");
  const explorer = isTestnet ? "https://explorer.testnet.chain.robinhood.com" : "https://explorer.chain.robinhood.com";
  // A plain Chain object (not viem's defineChain) so this config doesn't pull viem into pages that only read it.
  const chain: Chain = {
    id: CHAIN_IDS[network],
    name: isTestnet ? "Robinhood Chain Testnet" : "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Robinhood Chain Explorer", url: explorer } },
    testnet: isTestnet,
  };
  return chain;
}

export const arcusNetwork = readArcusNetwork(pinnedNetwork(deployment, undefined, process.env.NEXT_PUBLIC_ARCUS_NETWORK));

export const arcusConfig = {
  network: arcusNetwork,
  chainId: CHAIN_IDS[arcusNetwork],
  chain: robinhoodChain(arcusNetwork, process.env.NEXT_PUBLIC_ARCUS_RPC_URL),
  quoteSymbol: QUOTE_SYMBOLS[arcusNetwork],
  appUrl: "https://arcus.xyz",
};

/** Robinhood Chain testnet ETH faucet (gas for minting test USDG). */
export const ROBINHOOD_TESTNET_FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";
/** Test USDG minted per press. The token's mint is open but limited per wallet. */
export const TEST_USDG_MINT_AMOUNT = 500;

export function explorerTxUrl(hash: string) {
  return `${arcusConfig.chain.blockExplorers?.default.url}/tx/${hash}`;
}
