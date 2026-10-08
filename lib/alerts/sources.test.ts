import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readHlPositions } = await import("./sources");
const { batchMessages } = await import("./channels");

describe("readHlPositions", () => {
  it("reads clearinghouseState positions with the mark from value / size", () => {
    const positions = readHlPositions({
      assetPositions: [
        { position: { coin: "BTC", szi: "-0.5", entryPx: "62000.0", positionValue: "30500.0", unrealizedPnl: "500.0", liquidationPx: "70000.0" } },
        { position: { coin: "xyz:NVDA", szi: "10", entryPx: "180.0", positionValue: "1850.0", unrealizedPnl: "50.0", liquidationPx: null } },
        { position: { coin: "ETH", szi: "0.0", entryPx: "3000.0", positionValue: "0.0", unrealizedPnl: "0.0", liquidationPx: null } },
      ],
    });
    expect(positions).toEqual([
      { venue: "hyperliquid", coin: "BTC", size: -0.5, entryPx: 62_000, markPx: 61_000, liquidationPx: 70_000, unrealizedPnl: 500 },
      { venue: "hyperliquid", coin: "xyz:NVDA", size: 10, entryPx: 180, markPx: 185, liquidationPx: null, unrealizedPnl: 50 },
    ]);
  });
});

describe("batchMessages", () => {
  it("packs messages into posts under the limit without splitting one", () => {
    expect(batchMessages(["aaaa", "bbbb", "cccc"], 10)).toEqual(["aaaa\n\nbbbb", "cccc"]);
    expect(batchMessages(["x".repeat(20)], 10)).toEqual([`${"x".repeat(9)}…`]);
    expect(batchMessages([], 10)).toEqual([]);
  });
});
