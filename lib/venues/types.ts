/**
 * Venue abstraction: one implementation per exchange. The terminal talks to venues only through these
 * interfaces, so adding a venue never touches the order panel, positions bar or chart.
 *
 * - PerpVenue: leveraged perpetuals with positions and resting orders (Hyperliquid, Lighter).
 * - SpotVenue: quote-then-sign token swaps settled in the user's own wallet (Jupiter).
 */

export type OrderSide = "buy" | "sell";

export type OrderKind = "market" | "limit";

export type PerpVenueId = "hyperliquid" | "lighter";

/** Spot venues: Jupiter (Solana tokens) and Arcus (stock tokens on Robinhood Chain). */
export type SpotVenueId = "jupiter" | "arcus";

export interface VenueMarket {
  venue: PerpVenueId;
  /** The venue's own coin name, e.g. "BTC" or "xyz:NVDA" for a HIP-3 market. */
  coin: string;
  /** Display symbol shared with the rest of the terminal, e.g. "BTC" or "NVDA". */
  symbol: string;
  /** Perp dex the market lives on; "" is the main dex. */
  dex: string;
  /** Numeric asset id used in exchange actions (Lighter: `market_id`). */
  assetId: number;
  szDecimals: number;
  /** Lighter: prices are integers scaled by 10^priceDecimals. */
  priceDecimals?: number;
  /** Lighter: smallest order in base units and in USDC; the larger one applies. */
  minBaseAmount?: number;
  minQuoteAmount?: number;
  maxLeverage: number;
  kind: "crypto" | "stock";
  onlyIsolated: boolean;
  markPx?: number;
  midPx?: number;
}

export interface PlaceOrderInput {
  market: VenueMarket;
  side: OrderSide;
  kind: OrderKind;
  /** Size in base units (already rounded to the market's lot size or not; the venue rounds). */
  size: number;
  /** Required for limit orders. */
  limitPx?: number;
  reduceOnly?: boolean;
  /** Target leverage; the venue updates it first when it differs from the last value it set. */
  leverage?: number;
  isCross?: boolean;
  /** Reduce-only trigger orders attached to the entry (market when triggered). */
  takeProfit?: number;
  stopLoss?: number;
}

/** TP/SL trigger prices for an open position; an unset level is left as is. */
export interface PositionTpsl {
  takeProfit?: number;
  stopLoss?: number;
}

export type OrderResult =
  | { status: "filled"; oid: number; filledSize: number; avgPx: number }
  | { status: "resting"; oid: number };

export interface VenuePosition {
  venue: PerpVenueId;
  coin: string;
  symbol: string;
  dex: string;
  /** Signed size: positive long, negative short. */
  size: number;
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  leverage: number;
  leverageType: "cross" | "isolated";
}

export interface VenueOpenOrder {
  venue: PerpVenueId;
  coin: string;
  symbol: string;
  dex: string;
  oid: number;
  side: OrderSide;
  limitPx: number;
  size: number;
  origSize: number;
  orderType: string;
  reduceOnly: boolean;
  timestamp: number;
}

export interface AccountSnapshot {
  positions: VenuePosition[];
  orders: VenueOpenOrder[];
  accountValue: number;
  withdrawable: number;
}

export interface AccountHandlers {
  onSnapshot: (snapshot: AccountSnapshot) => void;
  onError?: (error: unknown) => void;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PerpVenue {
  kind: "perp";
  id: PerpVenueId;
  name: string;
  network: "mainnet" | "testnet";
  listMarkets(): Promise<VenueMarket[]>;
  /** Finds the market for a terminal symbol (e.g. "NVDA" → "xyz:NVDA"), or null when the venue doesn't list it. */
  resolveMarket(symbol: string): Promise<VenueMarket | null>;
  placeOrder(user: `0x${string}`, input: PlaceOrderInput): Promise<OrderResult>;
  cancelOrder(user: `0x${string}`, order: Pick<VenueOpenOrder, "coin" | "oid">): Promise<void>;
  closePosition(user: `0x${string}`, position: VenuePosition): Promise<OrderResult>;
  /** Places reduce-only take-profit and/or stop-loss trigger orders for the whole position. */
  setPositionTpsl(user: `0x${string}`, position: VenuePosition, levels: PositionTpsl): Promise<void>;
  /** Live positions and open orders. Returns an unsubscribe function. */
  subscribeAccount(user: `0x${string}`, handlers: AccountHandlers): () => void;
  loadCandles(market: VenueMarket, interval: string, startTime: number): Promise<Candle[]>;
}

export interface SpotToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  usdPrice?: number;
  liquidity?: number;
  isVerified: boolean;
}

export interface SpotQuoteInput {
  inputToken: SpotToken;
  outputToken: SpotToken;
  /** Input amount in the input token's smallest unit. */
  amount: bigint;
  /** Wallet that will sign; without it the venue returns a price-only quote. */
  taker?: string;
}

export interface SpotQuote {
  /** Opaque id the venue needs to execute this exact quote. */
  requestId: string;
  inputToken: SpotToken;
  outputToken: SpotToken;
  inAmount: bigint;
  outAmount: bigint;
  /** Minimum output after slippage. */
  minOutAmount: bigint;
  slippageBps: number;
  /** Percentage points, e.g. -0.12 means -0.12%. */
  priceImpactPct: number;
  /** Total swap fee in bps (venue + integrator) and the mint it is taken in. */
  feeBps: number;
  feeMint?: string;
  /** Network fees in lamports the taker pays (signature + priority + rent), when known. */
  networkFeeLamports: number;
  inUsdValue?: number;
  outUsdValue?: number;
  router?: string;
  /** Base64 transaction to sign, or null when the quote can't be executed (see error). */
  transaction: string | null;
  /** Why the quote can't be executed, already readable. */
  error?: string;
  fetchedAt: number;
}

export interface SpotSwapResult {
  signature: string;
  inAmount: bigint;
  outAmount: bigint;
  explorerUrl: string;
}

export interface SpotBalances {
  /** Native SOL in lamports. */
  lamports: bigint;
  /** Raw token amounts by mint. */
  tokens: Record<string, bigint>;
}

/** Signs a base64 transaction with the connected wallet and returns the signed base64 transaction. */
export type TransactionSigner = (transactionBase64: string) => Promise<string>;

export interface SpotVenue {
  kind: "spot";
  id: string;
  name: string;
  /** The stablecoin positions are sized in (USDC). */
  quoteToken(): Promise<SpotToken>;
  /** Resolves a symbol, or a mint when one is known, to the single verified token to trade. */
  resolveToken(query: { symbol: string; mint?: string }): Promise<SpotToken | null>;
  getQuote(input: SpotQuoteInput): Promise<SpotQuote>;
  executeQuote(quote: SpotQuote, sign: TransactionSigner): Promise<SpotSwapResult>;
  getBalances(owner: string, mints: string[]): Promise<SpotBalances>;
}

export type Venue = PerpVenue | SpotVenue;

/** An error the UI can show as is. */
export class VenueError extends Error {
  constructor(
    message: string,
    readonly raw?: string,
  ) {
    super(message);
    this.name = "VenueError";
  }
}
