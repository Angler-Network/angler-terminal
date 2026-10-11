import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import contracts from "./fixtures/contracts.json";
import candles from "./fixtures/candles.json";
import orderbook from "./fixtures/orderbook.json";
import refdata from "./fixtures/refdata.json";
import { dropCryptoClashes, oidOf, qfexStatusMessage, readQfexAccount, readQfexBook, readQfexCandles, readQfexFunding, readQfexMarkets, readQfexTrade, roundToStep, stepDecimals, type QfexRefdataRow } from "./markets";
import { qfexProxyRule } from "./proxy";
import { qfexSignature } from "./sign";
import { readQfexConfig } from "./config";
import type { VenueMarket } from "../types";

const rows = refdata.data as QfexRefdataRow[];

describe("readQfexMarkets", () => {
  const { markets, info } = readQfexMarkets(rows, contracts.data);

  it("lists active USD markets only, as stock-like perps", () => {
    expect(markets.map((market) => market.coin).sort()).toEqual(["AAPL-USD", "CL-USD", "GOLD-USD", "NVDA-USD", "US100-USD"]);
    const nvda = markets.find((market) => market.symbol === "NVDA")!;
    expect(nvda).toMatchObject({ venue: "qfex", coin: "NVDA-USD", kind: "stock", szDecimals: 3, priceDecimals: 2, minBaseAmount: 0.1, maxLeverage: 10, takerFee: 0.001 });
    expect(nvda.markPx).toBeGreaterThan(0);
    expect(markets.find((market) => market.symbol === "US100")?.takerFee).toBe(0.0005);
    expect(info.get("NVDA-USD")).toMatchObject({ tick: "0.01", lot: "0.001", minQuantity: 0.1 });
  });

  it("reads funding in percent per hour as a fraction", () => {
    const funding = readQfexFunding(rows, [{ ticker_id: "NVDA-USD", funding_rate: "0.01" }, { ticker_id: "SKHYNIX-KRW", funding_rate: "0.5" }]);
    expect(funding).toEqual([{ symbol: "NVDA", hourly: 0.0001 }]);
  });
});

describe("dropCryptoClashes", () => {
  const stock = (symbol: string, price: number) => ({ venue: "qfex", coin: `${symbol}-USD`, symbol, markPx: price, kind: "stock" }) as VenueMarket;
  const coin = (symbol: string, price?: number) => ({ venue: "hyperliquid", coin: symbol, symbol, markPx: price, kind: "crypto" }) as VenueMarket;

  it("drops a stock named like a crypto asset at another price, keeps the rest", () => {
    const kept = dropCryptoClashes([stock("PURR", 12), stock("NVDA", 180), stock("GOLD", 4000), stock("QNT", 70)], [coin("PURR", 0.2), coin("GOLD", 4010), coin("QNT")]);
    expect(kept.map((market) => market.symbol)).toEqual(["NVDA", "GOLD"]);
  });
});

describe("books, trades, candles", () => {
  it("drops the REST book's empty ticks and sorts each side", () => {
    const book = readQfexBook(orderbook)!;
    expect(book.bids.every((level) => level.size > 0)).toBe(true);
    expect(book.asks.every((level) => level.size > 0)).toBe(true);
    expect(book.bids[0].price).toBeLessThan(book.asks[0].price);
    expect(readQfexBook({ type: "level2", bid: [["10101.10", "0.45"]], ask: [["10102.55", "0.57"]] })).toEqual({ bids: [{ price: 10101.1, size: 0.45 }], asks: [{ price: 10102.55, size: 0.57 }] });
  });

  it("reads a public trade", () => {
    expect(readQfexTrade({ type: "trade", trade_id: "t1", time: "2026-10-10T09:00:00Z", symbol: "AAPL-USD", size: "5.2", price: "400.23", side: "sell" })).toEqual({
      id: "t1",
      price: 400.23,
      size: 5.2,
      side: "sell",
      time: Date.parse("2026-10-10T09:00:00Z"),
    });
  });

  it("turns candles oldest first", () => {
    const list = readQfexCandles(candles);
    expect(list.length).toBe(candles.candles.length);
    expect(list[0].time).toBeLessThan(list.at(-1)!.time);
  });
});

describe("readQfexAccount", () => {
  const markets = readQfexMarkets(rows, contracts.data).markets;

  it("maps positions, orders and the balance", () => {
    const snapshot = readQfexAccount(
      markets,
      [
        { symbol: "NVDA-USD", position: -2, average_price: 180, unrealised_pnl: 4, leverage: 5, margin: 72 },
        { symbol: "AAPL-USD", position: 0 },
      ],
      [{ id: "5b309929-206f-40ec-804d-cbe46e81afc1", symbol: "AAPL-USD", side: "BUY", type: "LIMIT", price: 200, quantity: 1, remaining: 1, time: 1, stop: false }],
      { available_balance: 900, position_margin: 72, order_margin: 20, unrealised_pnl: 4 },
    );
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]).toMatchObject({ venue: "qfex", symbol: "NVDA", size: -2, entryPx: 180, unrealizedPnl: 4, leverage: 5 });
    expect(snapshot.orders[0]).toMatchObject({ symbol: "AAPL", side: "buy", limitPx: 200, oid: oidOf("5b309929-206f-40ec-804d-cbe46e81afc1") });
    expect(snapshot.accountValue).toBe(996);
    expect(snapshot.withdrawable).toBe(900);
  });
});

describe("helpers", () => {
  it("rounds to steps", () => {
    expect(stepDecimals("0.001")).toBe(3);
    expect(stepDecimals("1")).toBe(0);
    expect(roundToStep(1.23456, "0.001", "down")).toBe(1.234);
    expect(roundToStep(336.146, "0.01")).toBe(336.15);
  });

  it("explains statuses", () => {
    expect(qfexStatusMessage("FAILED_MARGIN_CHECK")).toMatch(/margin/);
    expect(qfexStatusMessage("SOMETHING_NEW")).toBe("QFEX answered something new.");
  });

  it("signs like QFEX's examples (HMAC-SHA256 of nonce:timestamp, hex)", async () => {
    const expected = createHmac("sha256", "qfex_secret_yyyyyy").update("c0ffee:1760545414").digest("hex");
    expect(await qfexSignature("qfex_secret_yyyyyy", "c0ffee", 1760545414)).toBe(expected);
  });

  it("relays only allowed GETs", () => {
    expect(qfexProxyRule("GET", "/md/orderbook/AAPL-USD")).toEqual({ public: true });
    expect(qfexProxyRule("GET", "/user/positions")).toEqual({ public: false });
    expect(qfexProxyRule("POST", "/user/positions")).toBeNull();
    expect(qfexProxyRule("GET", "/user/transfer")).toBeNull();
    expect(qfexProxyRule("GET", "/builder/web3/api-key")).toBeNull();
  });

  it("reads the builder code and share", () => {
    expect(readQfexConfig({ NEXT_PUBLIC_QFEX_BUILDER_CODE: "11111111-1111-4111-8111-111111111111" })).toMatchObject({ builderCode: "11111111-1111-4111-8111-111111111111", builderShare: 0.5 });
    expect(readQfexConfig({ NEXT_PUBLIC_QFEX_BUILDER_CODE: "nope", NEXT_PUBLIC_QFEX_BUILDER_SHARE_BPS: "3000" })).toMatchObject({ builderCode: null, builderShare: 0.3 });
  });
});
