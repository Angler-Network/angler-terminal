import { describe, expect, it } from "vitest";
import { ago, readLargestHolders, readPoolTrades } from "./token-activity";

const CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
const SOL = "So11111111111111111111111111111111111111112";

describe("token activity", () => {
  it("reads pool trades from the token's side (real GeckoTerminal shape)", () => {
    const body = {
      data: [
        {
          attributes: {
            block_timestamp: "2026-10-07T18:06:00Z",
            tx_hash: "4Hiz",
            tx_from_address: "5Dug",
            kind: "sell",
            from_token_address: CBBTC,
            to_token_address: SOL,
            from_token_amount: "0.00883198",
            to_token_amount: "6.296938899",
            price_from_in_usd: "83421.87",
            price_to_in_usd: "117.0",
            volume_in_usd: "736.78",
          },
        },
        { attributes: { block_timestamp: "2026-10-07T18:07:00Z", tx_hash: "9x", tx_from_address: "7a", from_token_address: SOL, to_token_address: CBBTC, from_token_amount: "1", to_token_amount: "0.0014", price_to_in_usd: "83500", volume_in_usd: "117" } },
        { attributes: { tx_hash: "other", from_token_address: "A", to_token_address: "B" } },
      ],
    };
    const trades = readPoolTrades(body, "solana", CBBTC);
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ tx: "4Hiz", trader: "5Dug", side: "sell", amount: 0.00883198, usd: 736.78, price: 83421.87 });
    expect(trades[1]).toMatchObject({ side: "buy", amount: 0.0014, price: 83500 });
    // EVM addresses compare without case.
    expect(readPoolTrades({ data: [{ attributes: { ...body.data[1].attributes, to_token_address: "0xAbC" } }] }, "robinhood", "0xabc")).toHaveLength(1);
  });

  it("keys each swap on its own when one transaction holds several", () => {
    const swap = { block_timestamp: "2026-10-07T18:07:00Z", tx_hash: "0xaa", tx_from_address: "0x1", from_token_address: SOL, to_token_address: CBBTC, from_token_amount: "1", to_token_amount: "0.0014", volume_in_usd: "117" };
    const withIds = readPoolTrades({ data: [{ id: "eth_1_0xaa_3_1", attributes: swap }, { id: "eth_1_0xaa_7_1", attributes: swap }, { id: "eth_1_0xaa_7_1", attributes: swap }] }, "solana", CBBTC);
    expect(withIds.map((trade) => trade.id)).toEqual(["eth_1_0xaa_3_1", "eth_1_0xaa_7_1"]);
    const withoutIds = readPoolTrades({ data: [{ attributes: swap }, { attributes: swap }] }, "solana", CBBTC);
    expect(withoutIds.map((trade) => trade.id)).toEqual(["0xaa:0", "0xaa:1"]);
    expect(withoutIds.every((trade) => trade.tx === "0xaa")).toBe(true);
  });

  it("merges largest accounts per owner with their share of supply", () => {
    const holders = readLargestHolders(
      [
        { address: "acc1", uiAmount: 600 },
        { address: "acc2", uiAmount: 300 },
        { address: "acc3", uiAmount: 200 },
        { address: "acc4", uiAmount: 0 },
      ],
      { acc1: "pool", acc2: "whale", acc3: "whale" },
      2000,
    );
    expect(holders).toEqual([
      { owner: "pool", amount: 600, pct: 30 },
      { owner: "whale", amount: 500, pct: 25 },
    ]);
  });

  it("says how long ago", () => {
    expect(ago(1000, 29_000)).toBe("28s");
    expect(ago(0, 5 * 60_000)).toBe("5m");
    expect(ago(0, 3 * 3_600_000)).toBe("3h");
    expect(ago(0, 2 * 86_400_000)).toBe("2d");
  });
});
