import { deployment, pinnedNetwork } from "@/lib/deployment";

/**
 * Orderly (orderly.network, docs orderly.network/docs, index /docs/llms.txt): an omnichain order-book perp exchange with
 * no front end of its own. Integrators trade as a "broker": every account is registered under our broker id, and our
 * fee is whatever the broker's fee rate is set above Orderly's base fee (3 bps taker, 0 maker) in Orderly's builder
 * admin. Orders carry no fee field. The wallet signs EIP-712 (registration, the trading key, withdrawals); every other
 * request is signed by an ed25519 key made in this browser.
 * Network from the deployment, else NEXT_PUBLIC_ORDERLY_NETWORK (testnet default). The broker id comes from
 * NEXT_PUBLIC_ORDERLY_BROKER_ID; testnet falls back to Orderly's documented demo broker so development works without one.
 */

export type OrderlyNetwork = "mainnet" | "testnet";

const ENDPOINTS: Record<OrderlyNetwork, { api: string; ws: string; app: string }> = {
  mainnet: { api: "https://api.orderly.org", ws: "wss://ws-evm.orderly.org/ws/stream", app: "https://orderly.network" },
  testnet: { api: "https://testnet-api.orderly.org", ws: "wss://testnet-ws-evm.orderly.org/ws/stream", app: "https://testnet-dex.orderly.network" },
};

/** Orderly's own documented testnet broker, used only when no broker id is set. */
export const ORDERLY_TESTNET_DEMO_BROKER = "woofi_dex";

/** The off-chain EIP-712 domain's verifying contract (registration, trading keys). */
export const ORDERLY_OFFCHAIN_VERIFIER = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";

/** Where deposits go: Orderly's vault on Arbitrum (mainnet) or Arbitrum Sepolia (testnet), with its USDC. */
export const ORDERLY_VAULTS: Record<OrderlyNetwork, { chainId: number; vault: `0x${string}`; usdc: `0x${string}` }> = {
  mainnet: { chainId: 42161, vault: "0x816f722424B49Cf1275cc86DA9840Fbd5a6167e9", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  testnet: { chainId: 421614, vault: "0x0EaC556c0C2321BA25b9DC01e4e3c95aD5CDCd2f", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
};

/** Orderly's base taker fee; our broker fee is charged on top of it. */
export const ORDERLY_BASE_TAKER_FEE = 0.0003;

/** The example account id in Orderly's WebSocket docs: accepted by the public stream on mainnet and testnet. */
export const ORDERLY_DOCS_STREAM_ID = "OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY";

/**
 * Ids for the public stream's URL path, in the order to try them. Orderly closes the socket on an id it doesn't know
 * (it used to take any), so ours (`NEXT_PUBLIC_ORDERLY_STREAM_ID`, an Orderly account id) goes first when set and the
 * docs' example is the fallback.
 */
export function orderlyStreamIds(value: string | undefined) {
  const own = value?.trim() ?? "";
  const valid = /^(0x[0-9a-fA-F]{64}|[A-Za-z0-9]{8,80})$/.test(own);
  return valid && own !== ORDERLY_DOCS_STREAM_ID ? [own, ORDERLY_DOCS_STREAM_ID] : [ORDERLY_DOCS_STREAM_ID];
}

export function readOrderlyNetwork(value: string | undefined): OrderlyNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export function readOrderlyConfig(env: Record<string, string | undefined>, pinned = deployment) {
  const network = readOrderlyNetwork(pinnedNetwork(pinned, undefined, env.NEXT_PUBLIC_ORDERLY_NETWORK));
  const configured = env.NEXT_PUBLIC_ORDERLY_BROKER_ID?.trim() ?? "";
  const brokerId = /^[a-z0-9_]{2,40}$/.test(configured) ? configured : network === "testnet" ? ORDERLY_TESTNET_DEMO_BROKER : null;
  // Our total taker rate as set in Orderly's admin (base + our part), for cost comparisons; the base alone without it.
  const fee = Number(env.NEXT_PUBLIC_ORDERLY_TAKER_FEE);
  const takerFee = Number.isFinite(fee) && fee >= ORDERLY_BASE_TAKER_FEE && fee <= 0.01 ? fee : ORDERLY_BASE_TAKER_FEE;
  return {
    network,
    brokerId,
    /** True when the broker is ours (set in env), so fills earn our fee and count toward points. */
    ownBroker: Boolean(configured) && brokerId === configured,
    takerFee,
    apiUrl: ENDPOINTS[network].api,
    wsUrl: ENDPOINTS[network].ws,
    streamIds: orderlyStreamIds(env.NEXT_PUBLIC_ORDERLY_STREAM_ID),
    appUrl: ENDPOINTS[network].app,
    /** Chain id the wallet signs registration and keys for (Arbitrum, where deposits go). */
    signChainId: ORDERLY_VAULTS[network].chainId,
    vault: ORDERLY_VAULTS[network],
  };
}

export type OrderlyConfig = ReturnType<typeof readOrderlyConfig>;

export const orderlyConfig = readOrderlyConfig({
  NEXT_PUBLIC_ORDERLY_NETWORK: process.env.NEXT_PUBLIC_ORDERLY_NETWORK,
  NEXT_PUBLIC_ORDERLY_BROKER_ID: process.env.NEXT_PUBLIC_ORDERLY_BROKER_ID,
  NEXT_PUBLIC_ORDERLY_TAKER_FEE: process.env.NEXT_PUBLIC_ORDERLY_TAKER_FEE,
  NEXT_PUBLIC_ORDERLY_STREAM_ID: process.env.NEXT_PUBLIC_ORDERLY_STREAM_ID,
});
