/** EVM swap aggregators quoted next to Uniswap on the EVM swap chains. */
export const AGGREGATOR_PROVIDERS = ["zerox", "kyberswap", "lifi"] as const;
export type AggregatorProvider = (typeof AGGREGATOR_PROVIDERS)[number];

export const AGGREGATOR_NAMES: Record<AggregatorProvider, string> = { zerox: "0x", kyberswap: "KyberSwap", lifi: "LI.FI" };

export interface AggregatorQuoteRequest {
  provider: AggregatorProvider;
  chainId: number;
  sellToken: string;
  buyToken: string;
  /** Exact input, base units. */
  sellAmount: string;
  /** The signing wallet; price-only quotes leave it out. */
  taker?: string | null;
  slippageBps?: number | null;
  /** A firm quote with the transaction to send (needs `taker`). */
  execute?: boolean;
}

/** What /api/aggregators/quote answers. */
export interface AggregatorQuoteBody {
  provider: AggregatorProvider;
  outAmount: string;
  minOutAmount: string | null;
  feeBps: number;
  priceImpactPct?: number | null;
  gasFeeUsd?: number | null;
  route: string[];
  tx?: { to: string; data: string; value: string; gas?: string };
  /** The contract the input token must be approved to (ERC-20 inputs). */
  allowanceTarget?: string;
  /** 0x Gasless (firm quote): what the wallet signs instead of sending a transaction. */
  gasless?: GaslessOrder;
}

/** An EIP-712 payload from 0x Gasless, signed by the wallet as is. */
export interface GaslessTypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  domain: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * 0x Gasless: the trade to sign (a Permit2 witness the relayer settles, paying the gas from the swap), plus a gasless
 * approval to sign when the token supports one. `approvalNeeded` without an `approval` means the token needs a
 * one-time on-chain approval, which costs gas.
 */
export interface GaslessOrder {
  trade: { type: string; eip712: GaslessTypedData };
  approval: { type: string; eip712: GaslessTypedData } | null;
  approvalNeeded: boolean;
}

export interface GaslessSignature {
  signatureType: 2;
  v: number;
  r: string;
  s: string;
}

/** What /api/aggregators/gasless/status answers. */
export interface GaslessStatus {
  status: "pending" | "submitted" | "succeeded" | "confirmed" | "failed";
  txHash: string | null;
  reason: string | null;
}
