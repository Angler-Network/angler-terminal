import { deployment, pinnedNetwork } from "@/lib/deployment";

/**
 * Extended (extended.exchange, ex-X10; API docs api.docs.extended.exchange, product docs docs.extended.exchange/llms.txt):
 * a perp order book settling on Starknet (moving to Circle's Arc on 22 Oct 2026: re-check hosts, the signing domain and
 * deposits then). Builders attach `builderId` (our Extended clientId) and `builderFee` to each order; the fee is paid to
 * our Extended account daily. The wallet signs twice to set up (EIP-712: the Stark key derivation, then registration) and
 * once (`personal_sign`) to mint the account's API key; orders are Stark-signed in the browser with Extended's WASM.
 * Its REST API sends no CORS headers, so the browser reaches it through our proxy (`app/api/extended`, Tokyo, which
 * refuses Extended's restricted countries); the WebSockets are open to browsers.
 * Network from the deployment, else NEXT_PUBLIC_EXTENDED_NETWORK (testnet default).
 */

export type ExtendedNetwork = "mainnet" | "testnet";

const ENDPOINTS: Record<ExtendedNetwork, { host: string; ws: string; app: string; signingDomain: string; chainId: string }> = {
  mainnet: {
    host: "https://api.starknet.extended.exchange",
    ws: "wss://api.starknet.extended.exchange/stream.extended.exchange",
    app: "https://app.extended.exchange",
    signingDomain: "extended.exchange",
    chainId: "SN_MAIN",
  },
  testnet: {
    host: "https://api.starknet.sepolia.extended.exchange",
    ws: "wss://api.starknet.sepolia.extended.exchange/stream.extended.exchange",
    app: "https://starknet.sepolia.extended.exchange",
    signingDomain: "starknet.sepolia.extended.exchange",
    chainId: "SN_SEPOLIA",
  },
};

/** The Stark domain every order hash is computed under. */
export const EXTENDED_STARK_DOMAIN = { name: "Perpetuals", version: "v0", revision: "1" } as const;

/** Our default builder fee (3.5 bps, the terminal's base rate), capped by what Extended allows the builder. */
export const EXTENDED_DEFAULT_BUILDER_FEE = 0.00035;

export function readExtendedNetwork(value: string | undefined): ExtendedNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export function readExtendedConfig(env: Record<string, string | undefined>, pinned = deployment) {
  const network = readExtendedNetwork(pinnedNetwork(pinned, undefined, env.NEXT_PUBLIC_EXTENDED_NETWORK));
  const id = env.NEXT_PUBLIC_EXTENDED_BUILDER_ID?.trim() ?? "";
  const fee = Number(env.NEXT_PUBLIC_EXTENDED_BUILDER_FEE);
  const referral = env.NEXT_PUBLIC_EXTENDED_REFERRAL_CODE?.trim() ?? "";
  return {
    network,
    ...ENDPOINTS[network],
    /** Our Extended clientId (a mainnet account): orders carry it only on mainnet, where it exists. */
    builderId: network === "mainnet" && /^\d{1,12}$/.test(id) ? Number(id) : null,
    builderFee: Number.isFinite(fee) && fee >= 0 && fee <= 0.01 ? fee : EXTENDED_DEFAULT_BUILDER_FEE,
    referralCode: /^[A-Za-z0-9_-]{2,40}$/.test(referral) ? referral : null,
    /** Our proxy for Extended's REST API (no CORS there). */
    proxy: "/api/extended",
  };
}

export type ExtendedConfig = ReturnType<typeof readExtendedConfig>;

export const extendedConfig = readExtendedConfig({
  NEXT_PUBLIC_EXTENDED_NETWORK: process.env.NEXT_PUBLIC_EXTENDED_NETWORK,
  NEXT_PUBLIC_EXTENDED_BUILDER_ID: process.env.NEXT_PUBLIC_EXTENDED_BUILDER_ID,
  NEXT_PUBLIC_EXTENDED_BUILDER_FEE: process.env.NEXT_PUBLIC_EXTENDED_BUILDER_FEE,
  NEXT_PUBLIC_EXTENDED_REFERRAL_CODE: process.env.NEXT_PUBLIC_EXTENDED_REFERRAL_CODE,
});
