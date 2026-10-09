import { describe, expect, it } from "vitest";
import { readAlertCoins } from "./coins";

describe("readAlertCoins", () => {
  it("puts majors first, then main coins, then HIP-3 coins, and drops spot and outcome ids", () => {
    const coins = readAlertCoins({ "xyz:NVDA": 180, ZRO: 2, ETH: 4000, AAVE: 300, BTC: 100000, "@107": 40, "#10": 0.5, kPEPE: 0.01, DEAD: 0 });
    expect(coins.map((entry) => entry.coin)).toEqual(["BTC", "ETH", "AAVE", "kPEPE", "ZRO", "xyz:NVDA"]);
    expect(coins.at(-1)).toEqual({ coin: "xyz:NVDA", mid: 180, dex: "xyz" });
  });
});
