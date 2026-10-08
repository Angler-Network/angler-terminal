/** EVM swap aggregators quoted next to Uniswap on Ethereum, Base and Arbitrum. */
export type AggregatorProvider = "zerox" | "odos";

export const AGGREGATOR_NAMES: Record<AggregatorProvider, string> = { zerox: "0x", odos: "Odos" };

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
}
