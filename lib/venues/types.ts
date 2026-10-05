/**
 * Venue abstraction: one implementation per exchange. The terminal talks to venues only through this
 * interface, so adding a venue never touches the order panel, positions bar or chart.
 */

export type OrderSide = "buy" | "sell";

export type OrderKind = "market" | "limit";

export interface VenueMarket {
  /** The venue's own coin name, e.g. "BTC" or "xyz:NVDA" for a HIP-3 market. */
  coin: string;
  /** Display symbol shared with the rest of the terminal, e.g. "BTC" or "NVDA". */
  symbol: string;
  /** Perp dex the market lives on; "" is the main dex. */
  dex: string;
  /** Numeric asset id used in exchange actions. */
  assetId: number;
  szDecimals: number;
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
}

export type OrderResult =
  | { status: "filled"; oid: number; filledSize: number; avgPx: number }
  | { status: "resting"; oid: number };

export interface VenuePosition {
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

export interface Venue {
  id: string;
  name: string;
  network: "mainnet" | "testnet";
  listMarkets(): Promise<VenueMarket[]>;
  /** Finds the market for a terminal symbol (e.g. "NVDA" → "xyz:NVDA"), or null when the venue doesn't list it. */
  resolveMarket(symbol: string): Promise<VenueMarket | null>;
  placeOrder(user: `0x${string}`, input: PlaceOrderInput): Promise<OrderResult>;
  cancelOrder(user: `0x${string}`, order: Pick<VenueOpenOrder, "coin" | "oid">): Promise<void>;
  closePosition(user: `0x${string}`, position: VenuePosition): Promise<OrderResult>;
  /** Live positions and open orders. Returns an unsubscribe function. */
  subscribeAccount(user: `0x${string}`, handlers: AccountHandlers): () => void;
  loadCandles(market: VenueMarket, interval: string, startTime: number): Promise<Candle[]>;
}

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
