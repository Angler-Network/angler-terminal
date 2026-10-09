/**
 * Venue abstraction: one implementation per exchange. The terminal talks to venues only through these
 * interfaces, so adding a venue never touches the order panel, positions bar or chart.
 *
 * - PerpVenue: leveraged perpetuals with positions and resting orders (Hyperliquid, Lighter).
 * - SpotVenue: quote-then-sign token swaps settled in the user's own wallet (Jupiter).
 */

export type OrderSide = "buy" | "sell";

export type OrderKind = "market" | "limit";

export type PerpVenueId = "hyperliquid" | "lighter" | "lighterRh" | "aster" | "orderly";

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
  /** Taker fee as a fraction of notional when the venue reports it (Lighter); Hyperliquid uses its base tier. */
  takerFee?: number;
  kind: "crypto" | "stock";
  onlyIsolated: boolean;
  markPx?: number;
  midPx?: number;
  /** 24h stats when the venue reports them (refreshed with the market list, so up to a minute old). */
  volume24hUsd?: number;
  /** 24h price change in percent, when the venue reports it. */
  change24hPct?: number;
  /** Open interest in USD (base open interest × mark). */
  openInterestUsd?: number;
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
  /**
   * Base size the TP/SL closes when it covers only part of the entry. The entry then goes out alone and the TP/SL
   * follows on the filled position (market entries only); unset covers the whole entry.
   */
  tpslSize?: number;
}

/** TP/SL trigger prices for an open position; an unset level is left as is. */
export interface PositionTpsl {
  takeProfit?: number;
  stopLoss?: number;
  /** Base size (unsigned) the triggers close; unset closes the whole position. */
  size?: number;
}

/** What closing or protecting a position needs: its market and signed size. */
export type PositionRef = Pick<VenuePosition, "venue" | "coin" | "symbol" | "size">;

export type OrderResult =
  /** `partnerFeeBps`: our builder (Hyperliquid) or integrator (Lighter) fee on this fill, in bps. */
  | { status: "filled"; oid: number; filledSize: number; avgPx: number; partnerFeeBps: number }
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
  /** Closes `size` (base units, unsigned) at market, or the whole position when unset. */
  closePosition(user: `0x${string}`, position: PositionRef, size?: number): Promise<OrderResult>;
  /** Places reduce-only take-profit and/or stop-loss trigger orders for `levels.size` or the whole position. */
  setPositionTpsl(user: `0x${string}`, position: PositionRef, levels: PositionTpsl): Promise<void>;
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
  /** Where the token launched, when Jupiter knows (e.g. "pump.fun"). */
  launchpad?: string;
}

export interface SpotQuoteInput {
  inputToken: SpotToken;
  outputToken: SpotToken;
  /** Input amount in the input token's smallest unit. */
  amount: bigint;
  /** Wallet that will sign; without it the venue returns a price-only quote. */
  taker?: string;
  /** Fixed slippage tolerance in bps; unset lets the venue choose (Jupiter's real-time estimate). */
  slippageBps?: number | null;
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
  /** The DEXes the route trades through, in order (Jupiter's routePlan labels, Titan's step labels). */
  route?: string[];
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
  /** The token swaps are priced against: USDC, or `mint` when the swap card pays with another token. */
  quoteToken(mint?: string): Promise<SpotToken>;
  /** Resolves a symbol, or a mint when one is known, to the single verified token to trade. */
  resolveToken(query: { symbol: string; mint?: string }): Promise<SpotToken | null>;
  getQuote(input: SpotQuoteInput): Promise<SpotQuote>;
  executeQuote(quote: SpotQuote, sign: TransactionSigner): Promise<SpotSwapResult>;
  /** `fresh` skips the shared copy other panels may have read in the last few seconds (right before a trade). */
  getBalances(owner: string, mints: string[], options?: { fresh?: boolean }): Promise<SpotBalances>;
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
