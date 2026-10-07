import { describe, expect, it } from "vitest";
import { fromHlHistoricalOrder, fromLighterOrder, hlOutcome, lighterOutcome, type HlHistoricalOrder } from "./order-history";

const hlOrder = (status: string, extra: Partial<HlHistoricalOrder["order"]> = {}): HlHistoricalOrder => ({
  order: {
    coin: "xyz:NVDA",
    side: "B",
    limitPx: "180.5",
    sz: "0",
    origSz: "2",
    oid: 77,
    timestamp: 1_000,
    orderType: "Limit",
    triggerPx: "0.0",
    isTrigger: false,
    reduceOnly: false,
    ...extra,
  },
  status,
  statusTimestamp: 2_000,
});

describe("hyperliquid order history", () => {
  it("maps a filled limit order", () => {
    expect(fromHlHistoricalOrder(hlOrder("filled"), (coin) => coin.replace("xyz:", ""))).toMatchObject({
      id: "hyperliquid:77",
      time: 2_000,
      symbol: "NVDA",
      side: "buy",
      type: "Limit",
      price: 180.5,
      size: 2,
      filled: 2,
      outcome: "filled",
      status: "Filled",
    });
  });

  it("hides the slippage cap of market orders and keeps trigger prices", () => {
    const row = fromHlHistoricalOrder(hlOrder("triggered", { orderType: "Stop Market", isTrigger: true, triggerPx: "170" }), (coin) => coin);
    expect(row).toMatchObject({ type: "Stop market", price: null, triggerPrice: 170, outcome: "triggered" });
  });

  it("explains cancels and rejects, and spots partial fills", () => {
    expect(hlOutcome("marginCanceled", 0)).toEqual({ outcome: "canceled", status: "Canceled: margin" });
    expect(hlOutcome("canceled", 0.5)).toEqual({ outcome: "partial", status: "Partly filled, canceled" });
    expect(hlOutcome("badAloPxRejected", 0)).toEqual({ outcome: "rejected", status: "Rejected: bad alo px" });
    expect(hlOutcome("scheduledCancel", 0).outcome).toBe("canceled");
  });
});

describe("lighter order history", () => {
  const order = {
    order_index: 5,
    market_index: 1,
    initial_base_amount: "0.1",
    filled_base_amount: "0.04",
    price: "3024.66",
    is_ask: true,
    type: "limit",
    status: "canceled-too-much-slippage",
    reduce_only: true,
    updated_at: 1_640_995_200,
  };

  it("maps an order with seconds or milliseconds times", () => {
    const row = fromLighterOrder(order, (id) => (id === 1 ? "ETH" : null));
    expect(row).toMatchObject({
      id: "lighter:5",
      time: 1_640_995_200_000,
      symbol: "ETH",
      side: "sell",
      price: 3024.66,
      size: 0.1,
      filled: 0.04,
      outcome: "partial",
      status: "Partly filled, canceled: too much slippage",
      reduceOnly: true,
    });
    expect(fromLighterOrder({ ...order, updated_at: 1_640_995_200_123 }, () => "ETH")?.time).toBe(1_640_995_200_123);
  });

  it("skips orders of unknown markets", () => {
    expect(fromLighterOrder(order, () => null)).toBeNull();
  });

  it("reads statuses", () => {
    expect(lighterOutcome("filled", 1)).toEqual({ outcome: "filled", status: "Filled" });
    expect(lighterOutcome("canceled", 0)).toEqual({ outcome: "canceled", status: "Canceled" });
    expect(lighterOutcome("canceled-post-only", 0)).toEqual({ outcome: "canceled", status: "Canceled: post only" });
  });
});
