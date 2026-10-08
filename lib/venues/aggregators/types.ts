/** EVM swap aggregators quoted next to Uniswap on the EVM swap chains. */
export const AGGREGATOR_PROVIDERS = ["zerox", "odos", "kyberswap"] as const;
export type AggregatorProvider = (typeof AGGREGATOR_PROVIDERS)[number];

export const AGGREGATOR_NAMES: Record<AggregatorProvider, string> = { zerox: "0x", odos: "Odos", kyberswap: "KyberSwap" };

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
