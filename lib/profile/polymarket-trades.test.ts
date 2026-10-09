import { describe, expect, it } from "vitest";
import { polymarketAnglerVolume, readPolymarketBuilderTrades } from "./polymarket-trades";

const MAKER = "0x92c78D8f12a214184DB7aCBCCc6e34d8A197C136";
const trade = (over: Record<string, unknown> = {}) => ({ id: "t1", maker: MAKER, sizeUsdc: "3.06", matchTime: "1786256472", status: "TRADE_STATUS_CONFIRMED", builderFee: "0.001224", ...over });

describe("Polymarket builder trades", () => {
  it("reads settled trades that paid our fee and drops failed, fee-free or malformed ones", () => {
    const rows = readPolymarketBuilderTrades([trade(), trade({ id: "t2", status: "TRADE_STATUS_FAILED" }), trade({ id: "t3", maker: "nope" }), trade({ id: "t4", sizeUsdc: "0" }), trade({ id: "t7", builderFee: "0" })]);
    expect(rows).toEqual([{ id: "t1", maker: MAKER.toLowerCase(), usd: 3.06, time: 1786256472 }]);
  });

  it("sums the wallet's trades after the cursor, once each, with the beta part", () => {
    const rows = readPolymarketBuilderTrades([trade(), trade(), trade({ id: "t2", matchTime: "100" }), trade({ id: "t5", maker: "0x0000000000000000000000000000000000000001" }), trade({ id: "t6", sizeUsdc: "10", matchTime: "1786256500" })]);
    expect(polymarketAnglerVolume(rows, new Set([MAKER.toLowerCase()]), 200, (time) => time >= 1786256490_000)).toEqual({ usd: 13.06, betaUsd: 10, lastTime: 1786256500 });
  });
});
