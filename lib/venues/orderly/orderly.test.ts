import { ed25519 } from "@noble/curves/ed25519";
import { base58, base64urlnopad } from "@scure/base";
import { describe, expect, it } from "vitest";
import futures from "./fixtures/public-futures.json";
import info from "./fixtures/public-info.json";
import { ORDERLY_TESTNET_DEMO_BROKER, readOrderlyConfig } from "./config";
import { orderlyFundingRows } from "./funding";
import { orderlyBase, readOrderlyAccount, readOrderlyBook, readOrderlyCandles, readOrderlyMarkets, readOrderlyTrade, roundToTick, tickDecimals } from "./markets";
import { newOrderlyKey, orderlyAccountId, orderlyHash, orderlyHeaders, orderlyMessage } from "./sign";

describe("Orderly config", () => {
  it("needs a broker id on mainnet and falls back to the demo broker on testnet", () => {
    expect(readOrderlyConfig({}, "mainnet")).toMatchObject({ network: "mainnet", brokerId: null, ownBroker: false, signChainId: 42161 });
    expect(readOrderlyConfig({}, "testnet")).toMatchObject({ network: "testnet", brokerId: ORDERLY_TESTNET_DEMO_BROKER, ownBroker: false, signChainId: 421614 });
    expect(readOrderlyConfig({ NEXT_PUBLIC_ORDERLY_BROKER_ID: "angler", NEXT_PUBLIC_ORDERLY_TAKER_FEE: "0.0005" }, "mainnet")).toMatchObject({ brokerId: "angler", ownBroker: true, takerFee: 0.0005 });
    expect(readOrderlyConfig({ NEXT_PUBLIC_ORDERLY_TAKER_FEE: "0.0001" }, "mainnet").takerFee).toBe(0.0003);
  });
});

describe("Orderly markets", () => {
  it("maps public info and futures, drops broker-only markets, keeps lots and ticks", () => {
    const { markets, steps } = readOrderlyMarkets(info.rows, futures.rows);
    expect(markets.map((market) => market.symbol).sort()).toEqual(["1000PEPE", "BTC", "ETH"]);
    const btc = markets.find((market) => market.symbol === "BTC")!;
    expect(btc).toMatchObject({ venue: "orderly", coin: "PERP_BTC_USDC", szDecimals: 5, priceDecimals: 1, minQuoteAmount: 10, maxLeverage: 100 });
    expect(btc.markPx).toBeGreaterThan(0);
    expect(btc.volume24hUsd).toBeGreaterThan(0);
    expect(steps.get("PERP_1000PEPE_USDC")).toEqual({ baseTick: 100, quoteTick: 1e-7 });
  });

  it("names bases, decimals and rounds to the lot", () => {
    expect(orderlyBase("PERP_BTC_USDC")).toBe("BTC");
    expect(orderlyBase("PERP_AAOI_USDC_mythos")).toBeNull();
    expect([tickDecimals(0.00001), tickDecimals(0.1), tickDecimals(100)]).toEqual([5, 1, 0]);
    expect(roundToTick(0.123456, 0.00001)).toBe(0.12345);
    expect(roundToTick(1250, 100)).toBe(1200);
  });
});

describe("Orderly account and streams", () => {
  it("reads positions, open orders and collateral", () => {
    const { markets } = readOrderlyMarkets(info.rows, futures.rows);
    const snapshot = readOrderlyAccount(
      markets,
      {
        free_collateral: 80,
        total_collateral_value: 120,
        rows: [
          { symbol: "PERP_ETH_USDC", position_qty: -0.5, average_open_price: 2600, mark_price: 2500, est_liq_price: 2900, leverage: 10, margin_mode: "CROSS" },
          { symbol: "PERP_BTC_USDC", position_qty: 0 },
        ],
      },
      [{ order_id: 7, symbol: "PERP_BTC_USDC", side: "BUY", type: "LIMIT", price: 80000, quantity: 0.01, executed: 0.004, created_time: 5 }],
    );
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]).toMatchObject({ symbol: "ETH", size: -0.5, entryPx: 2600, unrealizedPnl: 50, liquidationPx: 2900, leverageType: "cross" });
    expect(snapshot.orders[0]).toMatchObject({ symbol: "BTC", oid: 7, side: "buy", limitPx: 80000, origSize: 0.01 });
    expect(snapshot.orders[0].size).toBeCloseTo(0.006);
    expect(snapshot).toMatchObject({ accountValue: 120, withdrawable: 80 });
  });

  it("reads candles, book snapshots and trades", () => {
    expect(readOrderlyCandles({ s: "ok", t: [10], o: [1], h: [2], l: [0.5], c: [1.5], v: [3] })).toEqual([{ time: 10_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }]);
    expect(readOrderlyCandles({ s: "no_data" })).toEqual([]);
    expect(readOrderlyBook({ asks: [[101, 2]], bids: [[99, 1], [98, 0]] })).toEqual({ asks: [{ price: 101, size: 2 }], bids: [{ price: 99, size: 1 }] });
    expect(readOrderlyTrade({ price: 100, size: 0.5, side: "SELL" }, 42, "t1")).toEqual({ id: "t1", price: 100, size: 0.5, side: "sell", time: 42 });
  });
});

describe("Orderly signing", () => {
  it("derives the account id from the wallet and the broker", () => {
    const id = orderlyAccountId("0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0", "woofi_dex");
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(orderlyAccountId("0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0", "angler")).not.toBe(id);
    expect(orderlyHash("USDC")).toBe("0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa");
  });

  it("signs timestamp + method + path + body with the trading key", () => {
    const key = newOrderlyKey();
    expect(key.publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
    const body = JSON.stringify({ symbol: "PERP_ETH_USDC" });
    const headers = orderlyHeaders(key.secret, "0xabc", 1649920583000, "POST", "/v1/order", body);
    expect(headers["orderly-key"]).toBe(key.publicKey);
    expect(headers["content-type"]).toBe("application/json");
    const message = new TextEncoder().encode(orderlyMessage(1649920583000, "post", "/v1/order", body));
    expect(orderlyMessage(1649920583000, "post", "/v1/order", body)).toBe(`1649920583000POST/v1/order${body}`);
    expect(ed25519.verify(base64urlnopad.decode(headers["orderly-signature"]), message, base58.decode(key.publicKey.slice(8)))).toBe(true);
    expect(orderlyHeaders(key.secret, "0xabc", 1, "GET", "/v1/positions", "")["content-type"]).toBe("application/x-www-form-urlencoded");
  });
});

describe("Orderly funding", () => {
  it("normalizes each market's last rate to 8 hours and drops broker-only markets", () => {
    const rows = orderlyFundingRows(
      [
        { symbol: "PERP_BTC_USDC", last_funding_rate: 0.00001 },
        { symbol: "PERP_DOGE_USDC", last_funding_rate: 0.0002 },
        { symbol: "PERP_AAOI_USDC_mythos", last_funding_rate: 0.1 },
      ],
      [
        { symbol: "PERP_BTC_USDC", funding_period: 8 },
        { symbol: "PERP_DOGE_USDC", funding_period: 4 },
      ],
    );
    expect(rows).toEqual([
      { exchange: "orderly", symbol: "BTC", rate: 0.00001 },
      { exchange: "orderly", symbol: "DOGE", rate: 0.0004 },
    ]);
  });
});
