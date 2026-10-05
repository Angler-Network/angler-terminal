import { describe, expect, it } from "vitest";
import { toOpenOrders, toPositions } from "./venue";

describe("account mapping", () => {
  it("maps clearinghouse positions and skips flat ones", () => {
    const positions = toPositions("xyz", {
      assetPositions: [
        {
          position: {
            coin: "xyz:NVDA",
            szi: "-2.5",
            entryPx: "120.5",
            positionValue: "300",
            unrealizedPnl: "-1.25",
            returnOnEquity: "-0.02",
            liquidationPx: null,
            leverage: { type: "isolated", value: 5 },
          },
        },
        {
          position: {
            coin: "xyz:TSLA",
            szi: "0",
            entryPx: "0",
            positionValue: "0",
            unrealizedPnl: "0",
            returnOnEquity: "0",
            liquidationPx: null,
            leverage: { type: "cross", value: 1 },
          },
        },
      ],
      marginSummary: { accountValue: "1000" },
      withdrawable: "500",
    });
    expect(positions).toEqual([
      {
        venue: "hyperliquid",
        coin: "xyz:NVDA",
        symbol: "NVDA",
        dex: "xyz",
        size: -2.5,
        entryPx: 120.5,
        positionValue: 300,
        unrealizedPnl: -1.25,
        returnOnEquity: -0.02,
        liquidationPx: null,
        leverage: 5,
        leverageType: "isolated",
      },
    ]);
  });

  it("maps open orders sides", () => {
    const [order] = toOpenOrders("", [
      { coin: "BTC", side: "A", limitPx: "70000", sz: "0.01", origSz: "0.02", oid: 9, orderType: "Limit", reduceOnly: false, timestamp: 5 },
    ]);
    expect(order).toMatchObject({ coin: "BTC", symbol: "BTC", side: "sell", limitPx: 70000, size: 0.01, origSize: 0.02, oid: 9 });
  });
});
