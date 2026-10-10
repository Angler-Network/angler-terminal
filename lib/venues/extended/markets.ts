import type { AccountSnapshot, Candle, VenueMarket, VenueOpenOrder, VenuePosition } from "../types";
import { stepDecimals } from "./amounts";

/**
 * Extended's wire shapes (checked against the live API, `fixtures/`) and their mapping to the terminal's. Market names
 * are `BTC-USD`; tokenized stocks trading 24/5 carry a suffix (`TSLA_24_5-USD`), dropped from the terminal symbol.
 */

export interface ExtendedMarketRow {
  name: string;
  assetName: string;
  category?: string;
  type?: string;
  status?: string;
  active?: boolean;
  marketStats?: {
    dailyVolume?: string;
    dailyPriceChangePercentage?: string;
    lastPrice?: string;
    askPrice?: string;
    bidPrice?: string;
    markPrice?: string;
    fundingRate?: string;
    openInterest?: string;
  };
  tradingConfig?: {
    minOrderSize?: string;
    minOrderSizeChange?: string;
    minPriceChange?: string;
    maxLeverage?: string;
    limitPriceCap?: string;
    limitPriceFloor?: string;
    maxMarketOrderValue?: string;
    maxPositionValue?: string;
  };
  l2Config?: { syntheticId?: string; syntheticResolution?: number; collateralId?: string; collateralResolution?: number };
}

/** What signing and rounding an order on a market needs, beside the terminal's `VenueMarket`. */
export interface ExtendedMarketInfo {
  name: string;
  minOrderSize: string;
  sizeStep: string;
  tick: string;
  priceCap: number;
  priceFloor: number;
  /** Signed size of a whole-position TP/SL: max position value × 50 / price (Extended's `calc_entire_position_size`). */
  maxPositionValue: string;
  syntheticId: string;
  syntheticResolution: number;
  collateralId: string;
  collateralResolution: number;
}

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** "TSLA_24_5" → "TSLA"; crypto names as Extended writes them (kPEPE, 1000BONK). */
export function extendedSymbol(assetName: string) {
  return assetName.replace(/_24_5$/, "");
}

/** Active perpetual markets, and the signing details per market name. */
export function readExtendedMarkets(rows: ExtendedMarketRow[]): { markets: VenueMarket[]; info: Map<string, ExtendedMarketInfo> } {
  const markets: VenueMarket[] = [];
  const info = new Map<string, ExtendedMarketInfo>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.type !== "PERPETUAL" || row.status !== "ACTIVE" || row.active === false) continue;
    const l2 = row.l2Config;
    const config = row.tradingConfig;
    if (!l2?.syntheticId || !l2.collateralId || !l2.syntheticResolution || !l2.collateralResolution || !config?.minPriceChange || !config.minOrderSizeChange) continue;
    const symbol = extendedSymbol(row.assetName);
    // One market per symbol (the first listed), so a symbol always resolves to the same market.
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const stats = row.marketStats ?? {};
    const mark = num(stats.markPrice);
    const bid = num(stats.bidPrice);
    const ask = num(stats.askPrice);
    const change = num(stats.dailyPriceChangePercentage);
    markets.push({
      venue: "extended",
      coin: row.name,
      symbol,
      dex: "",
      assetId: 0,
      szDecimals: stepDecimals(config.minOrderSizeChange),
      priceDecimals: stepDecimals(config.minPriceChange),
      maxLeverage: Math.max(1, Math.floor(num(config.maxLeverage) ?? 1)),
      minBaseAmount: num(config.minOrderSize ?? config.minOrderSizeChange),
      kind: row.category === "Crypto" ? "crypto" : "stock",
      onlyIsolated: false,
      markPx: mark,
      midPx: bid && ask ? (bid + ask) / 2 : mark,
      volume24hUsd: num(stats.dailyVolume),
      change24hPct: change === undefined ? undefined : change * 100,
      openInterestUsd: num(stats.openInterest),
    });
    info.set(row.name, {
      name: row.name,
      minOrderSize: config.minOrderSize ?? config.minOrderSizeChange,
      sizeStep: config.minOrderSizeChange,
      tick: config.minPriceChange,
      priceCap: num(config.limitPriceCap) ?? 0.05,
      priceFloor: num(config.limitPriceFloor) ?? 0.05,
      maxPositionValue: config.maxPositionValue ?? "1000000",
      syntheticId: l2.syntheticId,
      syntheticResolution: l2.syntheticResolution,
      collateralId: l2.collateralId,
      collateralResolution: l2.collateralResolution,
    });
  }
  return { markets, info };
}

/** Hourly funding rates by market name, from the market list (Extended pays funding every hour). */
export function readExtendedFunding(rows: ExtendedMarketRow[]) {
  return rows.flatMap((row) => {
    const rate = num(row.marketStats?.fundingRate);
    return row.type === "PERPETUAL" && row.status === "ACTIVE" && rate !== undefined ? [{ symbol: extendedSymbol(row.assetName), hourly: rate }] : [];
  });
}

export interface ExtendedPositionRow {
  market: string;
  side: "LONG" | "SHORT";
  size: string;
  value?: string;
  openPrice?: string;
  markPrice?: string;
  liquidationPrice?: string | null;
  unrealisedPnl?: string;
  leverage?: string;
}

export interface ExtendedOrderRow {
  id: number | string;
  externalId?: string;
  market: string;
  type?: string;
  side: "BUY" | "SELL";
  status?: string;
  price?: string | null;
  qty: string;
  filledQty?: string | null;
  averagePrice?: string | null;
  reduceOnly?: boolean;
  createdTime?: number;
}

export interface ExtendedBalance {
  equity?: string;
  availableForWithdrawal?: string;
  availableForTrade?: string;
}

const LIVE_ORDER = new Set(["NEW", "PARTIALLY_FILLED", "UNTRIGGERED", "TRIGGERED"]);

/**
 * Extended order ids pass 2^53, so a number can't hold them exactly: the terminal's `oid` is a hash of the external id
 * (stable, positive, within 2^53) and the venue keeps the map back to it for cancels.
 */
export function oidOf(externalId: string) {
  let hash = 0n;
  for (const char of externalId) hash = (hash * 131n + BigInt(char.charCodeAt(0))) % 9_007_199_254_740_881n;
  return Number(hash);
}

export function readExtendedAccount(markets: VenueMarket[], positions: ExtendedPositionRow[], orders: ExtendedOrderRow[], balance: ExtendedBalance | null): AccountSnapshot {
  const byName = new Map(markets.map((market) => [market.coin, market]));
  const symbolOf = (name: string) => byName.get(name)?.symbol ?? name.replace(/-USD$/, "").replace(/_24_5$/, "");
  return {
    positions: positions.flatMap((row): VenuePosition[] => {
      const size = num(row.size) ?? 0;
      if (!size) return [];
      const value = Math.abs(num(row.value) ?? size * (num(row.markPrice) ?? 0));
      const leverage = num(row.leverage) ?? 1;
      const pnl = num(row.unrealisedPnl) ?? 0;
      const margin = leverage > 0 ? value / leverage : value;
      const liquidation = num(row.liquidationPrice);
      return [
        {
          venue: "extended",
          coin: row.market,
          symbol: symbolOf(row.market),
          dex: "",
          size: row.side === "SHORT" ? -Math.abs(size) : Math.abs(size),
          entryPx: num(row.openPrice) ?? 0,
          positionValue: value,
          unrealizedPnl: pnl,
          returnOnEquity: margin > 0 ? pnl / margin : 0,
          liquidationPx: liquidation && liquidation > 0 ? liquidation : null,
          leverage,
          leverageType: "cross",
        },
      ];
    }),
    orders: orders.flatMap((row): VenueOpenOrder[] => {
      if (row.status && !LIVE_ORDER.has(row.status)) return [];
      const qty = num(row.qty) ?? 0;
      const filled = num(row.filledQty) ?? 0;
      const externalId = row.externalId ?? String(row.id);
      return [
        {
          venue: "extended",
          coin: row.market,
          symbol: symbolOf(row.market),
          dex: "",
          oid: oidOf(externalId),
          side: row.side === "BUY" ? "buy" : "sell",
          limitPx: num(row.price) ?? 0,
          size: Math.max(0, qty - filled),
          origSize: qty,
          orderType: row.type === "TPSL" ? "TP/SL" : row.type === "CONDITIONAL" ? "Trigger" : row.type === "MARKET" ? "Market" : "Limit",
          reduceOnly: Boolean(row.reduceOnly),
          timestamp: row.createdTime ?? 0,
        },
      ];
    }),
    accountValue: num(balance?.equity) ?? 0,
    withdrawable: num(balance?.availableForWithdrawal) ?? 0,
  };
}

/** `/info/candles/{market}/trades` rows (newest first) → oldest-first candles. */
export function readExtendedCandles(rows: Array<{ o?: string; h?: string; l?: string; c?: string; v?: string; T?: number }>): Candle[] {
  return rows
    .flatMap((row) => {
      const close = num(row.c);
      if (close === undefined || !row.T) return [];
      return [{ time: row.T, open: num(row.o) ?? close, high: num(row.h) ?? close, low: num(row.l) ?? close, close, volume: num(row.v) ?? 0 }];
    })
    .sort((a, b) => a.time - b.time);
}

/** Chart intervals → Extended's (ISO 8601 durations). Intervals it lacks are left to the chart's fallback. */
export const EXTENDED_INTERVALS: Record<string, string> = {
  "1m": "PT1M",
  "5m": "PT5M",
  "15m": "PT15M",
  "30m": "PT30M",
  "1h": "PT1H",
  "2h": "PT2H",
  "4h": "PT4H",
  "8h": "PT8H",
  "12h": "PT12H",
  "1d": "P1D",
  "1w": "P7D",
  "1M": "P30D",
};
