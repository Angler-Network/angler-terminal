import type { AccountSnapshot, Candle, VenueMarket, VenueOpenOrder, VenuePosition } from "../types";
import { splitAsterSymbol } from "./funding";

/**
 * Aster market and account payloads (Binance-style futures API) mapped to the terminal's venue types. Pure,
 * unit-tested. A base asset listed against both USDT and USD1 keeps its USDT market, so each symbol is one market.
 */

export interface AsterSymbolInfo {
  symbol: string;
  status?: string;
  contractType?: string;
  baseAsset?: string;
  quoteAsset?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  requiredMarginPercent?: string;
  underlyingSubType?: string[];
  filters?: Array<Record<string, unknown>>;
}

export interface AsterTicker {
  symbol: string;
  lastPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
}

export interface AsterPremiumRow {
  symbol: string;
  markPrice?: string;
}

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function filter(info: AsterSymbolInfo, type: string) {
  return info.filters?.find((entry) => entry.filterType === type);
}

/** Decimals of a step like "0.001" (3) or "1" (0). */
export function stepDecimals(step: unknown, fallback: number) {
  const text = typeof step === "string" ? step : "";
  if (!text || Number(text) <= 0) return fallback;
  const trimmed = text.includes(".") ? text.replace(/0+$/, "") : text;
  const dot = trimmed.indexOf(".");
  return dot === -1 ? 0 : trimmed.length - dot - 1;
}

export function readAsterMarkets(symbols: AsterSymbolInfo[], tickers: AsterTicker[], premium: AsterPremiumRow[]): VenueMarket[] {
  const tickerOf = new Map(tickers.map((entry) => [entry.symbol, entry]));
  const markOf = new Map(premium.map((entry) => [entry.symbol, num(entry.markPrice)]));
  const bySymbol = new Map<string, VenueMarket & { quote: string }>();
  symbols.forEach((info, index) => {
    if (info.status !== "TRADING" || info.contractType !== "PERPETUAL") return;
    const split = splitAsterSymbol(info.symbol);
    if (!split || !/^[A-Z0-9]{1,20}$/.test(split.base)) return;
    const ticker = tickerOf.get(info.symbol);
    const lot = filter(info, "LOT_SIZE");
    const price = filter(info, "PRICE_FILTER");
    const required = num(info.requiredMarginPercent);
    const mark = markOf.get(info.symbol) ?? num(ticker?.lastPrice);
    const market: VenueMarket & { quote: string } = {
      quote: split.quote,
      venue: "aster",
      coin: info.symbol,
      symbol: split.base,
      dex: "",
      assetId: index,
      szDecimals: stepDecimals(lot?.stepSize, info.quantityPrecision ?? 3),
      priceDecimals: stepDecimals(price?.tickSize, info.pricePrecision ?? 2),
      minBaseAmount: num(lot?.minQty) ?? 0,
      minQuoteAmount: num(filter(info, "MIN_NOTIONAL")?.notional) ?? 0,
      maxLeverage: required && required > 0 ? Math.max(1, Math.floor(100 / required)) : 20,
      kind: info.underlyingSubType?.some((tag) => tag.toUpperCase() === "STOCK") ? "stock" : "crypto",
      onlyIsolated: false,
      markPx: mark && mark > 0 ? mark : undefined,
      midPx: num(ticker?.lastPrice),
      volume24hUsd: num(ticker?.quoteVolume),
      change24hPct: num(ticker?.priceChangePercent),
    };
    const current = bySymbol.get(split.base);
    if (!current || (current.quote !== "USDT" && split.quote === "USDT")) bySymbol.set(split.base, market);
  });
  return [...bySymbol.values()].map(({ quote: _quote, ...market }) => market);
}

export interface AsterPositionRow {
  symbol: string;
  positionAmt?: string;
  entryPrice?: string;
  markPrice?: string;
  unRealizedProfit?: string;
  liquidationPrice?: string;
  leverage?: string;
  marginType?: string;
  notional?: string;
  isolatedWallet?: string;
}

export interface AsterOrderRow {
  orderId: number;
  symbol: string;
  side?: string;
  type?: string;
  origType?: string;
  price?: string;
  stopPrice?: string;
  origQty?: string;
  executedQty?: string;
  reduceOnly?: boolean;
  closePosition?: boolean;
  time?: number;
  updateTime?: number;
}

export interface AsterAccountInfo {
  totalMarginBalance?: string;
  availableBalance?: string;
  maxWithdrawAmount?: string;
}

/** Positions, open orders and balances, with symbols mapped back through the market list. */
export function readAsterAccount(markets: VenueMarket[], positions: AsterPositionRow[], orders: AsterOrderRow[], account: AsterAccountInfo): AccountSnapshot {
  const byCoin = new Map(markets.map((market) => [market.coin, market]));
  const symbolOf = (coin: string) => byCoin.get(coin)?.symbol ?? splitAsterSymbol(coin)?.base ?? coin;
  const open: VenuePosition[] = positions.flatMap((row) => {
    const size = num(row.positionAmt) ?? 0;
    if (!size) return [];
    const entryPx = num(row.entryPrice) ?? 0;
    const pnl = num(row.unRealizedProfit) ?? 0;
    const value = Math.abs(num(row.notional) ?? size * (num(row.markPrice) ?? entryPx));
    const leverage = num(row.leverage) ?? 1;
    const margin = row.marginType === "isolated" ? num(row.isolatedWallet) ?? value / leverage : value / leverage;
    const liq = num(row.liquidationPrice);
    return [
      {
        venue: "aster",
        coin: row.symbol,
        symbol: symbolOf(row.symbol),
        dex: "",
        size,
        entryPx,
        positionValue: value,
        unrealizedPnl: pnl,
        returnOnEquity: margin > 0 ? pnl / margin : 0,
        liquidationPx: liq && liq > 0 ? liq : null,
        leverage,
        leverageType: row.marginType === "isolated" ? "isolated" : "cross",
      },
    ];
  });
  const resting: VenueOpenOrder[] = orders.map((row) => {
    const orig = num(row.origQty) ?? 0;
    const trigger = num(row.stopPrice);
    return {
      venue: "aster",
      coin: row.symbol,
      symbol: symbolOf(row.symbol),
      dex: "",
      oid: row.orderId,
      side: row.side === "SELL" ? "sell" : "buy",
      limitPx: num(row.price) || trigger || 0,
      size: Math.max(0, orig - (num(row.executedQty) ?? 0)),
      origSize: orig,
      orderType: (row.origType ?? row.type ?? "LIMIT").replace(/_/g, " ").toLowerCase(),
      reduceOnly: Boolean(row.reduceOnly || row.closePosition),
      timestamp: row.time ?? row.updateTime ?? 0,
    };
  });
  return {
    positions: open,
    orders: resting,
    accountValue: num(account.totalMarginBalance) ?? 0,
    withdrawable: num(account.maxWithdrawAmount) ?? num(account.availableBalance) ?? 0,
  };
}

/** Binance-style klines: [openTime, open, high, low, close, volume, ...]. */
export function readAsterCandles(rows: unknown): Candle[] {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const [time, open, high, low, close, volume] = row.map(Number);
    return Number.isFinite(time) && Number.isFinite(close) ? [{ time, open, high, low, close, volume }] : [];
  });
}
