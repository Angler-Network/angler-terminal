import { describe, expect, it } from "vitest";
import ws from "./fixtures/account-ws.json";
import {
  applyAccountAll,
  applyOrders,
  applyUserStats,
  emptyAccountState,
  readAccountIndex,
  readOpenOrder,
  readOrderOutcome,
  toSnapshot,
} from "./account";

// account_all and user_stats captured from Lighter testnet (public market-maker account), 2026-10-05.
const symbols = new Map([
  [4095, "ETH"],
  [4096, "BTC"],
  [4097, "SOL"],
]);
const symbolFor = (id: number) => symbols.get(id);

/** Order JSON as documented in the WebSocket reference. */
function order(overrides: Record<string, unknown> = {}) {
  return {
    order_index: 281476612587355,
    client_order_index: 123,
    market_index: 4097,
    initial_base_amount: "0.500",
    remaining_base_amount: "0.300",
    price: "119.500",
    is_ask: false,
    type: "limit",
    time_in_force: "good-till-time",
    reduce_only: false,
    status: "open",
    filled_base_amount: "0.200",
    filled_quote_amount: "23.900000",
    created_at: 1791221681,
    ...overrides,
  };
}

describe("accountsByL1Address", () => {
  it("returns the master account index", () => {
    expect(readAccountIndex({ code: 200, sub_accounts: [{ index: 300, account_type: 1 }, { index: 124, account_type: 0 }] })).toBe(124);
    expect(readAccountIndex({ code: 21100, message: "account not found" })).toBeNull();
    expect(readAccountIndex({ code: 200, sub_accounts: [] })).toBeNull();
  });
});

describe("account_all", () => {
  it("reads signed positions from the snapshot", () => {
    const state = emptyAccountState();
    applyAccountAll(state, ws.account_all_snapshot, true);
    const sol = toSnapshot(state).positions.find((position) => position.symbol === "SOL");
    expect(sol).toMatchObject({
      venue: "lighter",
      coin: "SOL",
      size: -33.11,
      entryPx: 119.925,
      positionValue: 3966.44556,
      unrealizedPnl: 4.257953,
      leverage: 15,
      leverageType: "cross",
    });
    expect(sol?.returnOnEquity).toBeCloseTo(4.257953 / (3966.44556 / 15));
    expect(state.positions.size).toBe(3);
  });

  it("merges updates that only carry changed markets, and drops closed positions", () => {
    const state = emptyAccountState();
    applyAccountAll(state, ws.account_all_snapshot, true);
    applyAccountAll(state, ws.account_all_update, false);
    expect(state.positions.size).toBe(3);
    applyAccountAll(state, { positions: { 4097: { symbol: "SOL", sign: 1, position: "0.000" } } }, false);
    expect([...state.positions.values()].map((position) => position.symbol).sort()).toEqual(["BTC", "ETH"]);
  });
});

describe("user_stats", () => {
  it("reads portfolio value and available balance", () => {
    const state = emptyAccountState();
    applyUserStats(state, ws.user_stats);
    expect(state).toMatchObject({ accountValue: 100063308.893027, withdrawable: 100010845.435988 });
  });
});

describe("orders", () => {
  it("reads live orders and drops finished ones on update", () => {
    expect(readOpenOrder(order(), symbolFor)).toMatchObject({
      venue: "lighter",
      symbol: "SOL",
      oid: 281476612587355,
      side: "buy",
      limitPx: 119.5,
      size: 0.3,
      origSize: 0.5,
      orderType: "Limit",
      timestamp: 1791221681000,
    });
    const state = emptyAccountState();
    applyOrders(state, { orders: { 4097: [order(), order({ order_index: 2, is_ask: true })] } }, true, symbolFor);
    expect(state.orders.size).toBe(2);
    applyOrders(state, { orders: { 4097: [order({ status: "filled" })] } }, false, symbolFor);
    expect([...state.orders.keys()]).toEqual([2]);
    expect(readOpenOrder(order({ market_index: 1 }), symbolFor)).toBeNull();
  });

  it("classifies order outcomes for confirmation", () => {
    expect(readOrderOutcome(order({ status: "filled", filled_base_amount: "0.5", filled_quote_amount: "60" }))).toEqual({
      state: "filled",
      orderIndex: 281476612587355,
      filledSize: 0.5,
      avgPx: 120,
    });
    // IOC partly filled then canceled still counts as a fill.
    expect(readOrderOutcome(order({ status: "canceled-not-enough-liquidity" }))).toMatchObject({ state: "filled", filledSize: 0.2 });
    expect(readOrderOutcome(order({ status: "canceled-too-much-slippage", filled_base_amount: "0" }))).toEqual({
      state: "canceled",
      status: "canceled-too-much-slippage",
    });
    expect(readOrderOutcome(order({ status: "open" }))).toMatchObject({ state: "resting" });
    expect(readOrderOutcome(order({ status: "in-progress" }))).toEqual({ state: "working" });
  });
});

describe("socket errors", () => {
  it("has the documented error shape", () => {
    expect(ws.auth_error.error.code).toBe(20001);
  });
});
