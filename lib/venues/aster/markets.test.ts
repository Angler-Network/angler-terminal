import { describe, expect, it } from "vitest";
import { readAsterAccount, readAsterCandles, readAsterMarkets, stepDecimals } from "./markets";

const btc = {
  symbol: "BTCUSDT",
  status: "TRADING",
  contractType: "PERPETUAL",
  pricePrecision: 1,
  quantityPrecision: 3,
  requiredMarginPercent: "1.0000",
  underlyingSubType: ["Top"],
  filters: [
    { filterType: "PRICE_FILTER", tickSize: "0.1" },
    { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001" },
    { filterType: "MIN_NOTIONAL", notional: "5" },
  ],
};

describe("Aster markets", () => {
  it("maps symbols, lots, leverage and stats, keeping one market per base", () => {
    expect(stepDecimals("0.0010", 8)).toBe(3);
    expect(stepDecimals("1", 8)).toBe(0);
    const markets = readAsterMarkets(
      [
        { ...btc, symbol: "BTCUSD1" },
        btc,
        { ...btc, symbol: "TSLAUSDT", requiredMarginPercent: "10", underlyingSubType: ["STOCK"] },
        { ...btc, symbol: "OLDUSDT", status: "SETTLING" },
      ],
      [{ symbol: "BTCUSDT", lastPrice: "83000", priceChangePercent: "-1.5", quoteVolume: "469000000" }],
      [{ symbol: "BTCUSDT", markPrice: "83010" }],
    );
    expect(markets.map((market) => market.coin)).toEqual(["BTCUSDT", "TSLAUSDT"]);
    expect(markets[0]).toMatchObject({ venue: "aster", symbol: "BTC", szDecimals: 3, priceDecimals: 1, minQuoteAmount: 5, maxLeverage: 100, markPx: 83010, change24hPct: -1.5, kind: "crypto" });
    expect(markets[1]).toMatchObject({ symbol: "TSLA", maxLeverage: 10, kind: "stock" });
  });

  it("reads positions, open orders, balances and candles", () => {
    const markets = readAsterMarkets([btc], [], []);
    const snapshot = readAsterAccount(
      markets,
      [
        { symbol: "BTCUSDT", positionAmt: "-0.010", entryPrice: "84000", markPrice: "83000", unRealizedProfit: "10", liquidationPrice: "90000", leverage: "10", marginType: "cross", notional: "-830" },
        { symbol: "ETHUSDT", positionAmt: "0" },
      ],
      [{ orderId: 5, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", price: "80000", origQty: "0.01", executedQty: "0.004", time: 9 }],
      { totalMarginBalance: "1000", maxWithdrawAmount: "700" },
    );
    expect(snapshot.positions).toEqual([
      expect.objectContaining({ venue: "aster", symbol: "BTC", size: -0.01, positionValue: 830, unrealizedPnl: 10, liquidationPx: 90000, leverage: 10, leverageType: "cross" }),
    ]);
    expect(snapshot.orders[0]).toMatchObject({ oid: 5, side: "buy", limitPx: 80000, size: 0.006, origSize: 0.01, orderType: "limit" });
    expect(snapshot).toMatchObject({ accountValue: 1000, withdrawable: 700 });
    expect(readAsterCandles([[1, "2", "3", "1", "2.5", "10", 2]])).toEqual([{ time: 1, open: 2, high: 3, low: 1, close: 2.5, volume: 10 }]);
  });
});
