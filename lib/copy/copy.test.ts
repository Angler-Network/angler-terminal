import { describe, expect, it } from "vitest";
import { leaderEvents, type LeaderPosition } from "./events";
import { DEFAULT_COPY, MAX_COPYING, readFollow, readFollows, readWatchedWallets } from "./follows";
import { copyPlan, openUsd } from "./sizing";

const pos = (coin: string, size: number, entryPx = 100, markPx = entryPx): LeaderPosition => ({ coin, size, entryPx, markPx });
const ADDRESS = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";

describe("leaderEvents", () => {
  it("reads opens, adds, reductions, flips and closes", () => {
    const before = { BTC: pos("BTC", 1, 100), ETH: pos("ETH", -2, 50, 55), SOL: pos("SOL", 10, 20, 22), DOGE: pos("DOGE", 5, 1) };
    const after = { BTC: pos("BTC", 2, 110, 120), ETH: pos("ETH", -1, 50, 60), SOL: pos("SOL", -4, 21, 21), HYPE: pos("HYPE", 3, 40) };
    const events = leaderEvents(before, after);
    expect(events).toEqual([
      { kind: "add", coin: "BTC", before: 1, after: 2, price: 120 },
      { kind: "reduce", coin: "ETH", before: -2, after: -1, price: 60 },
      { kind: "flip", coin: "SOL", before: 10, after: -4, price: 21 },
      { kind: "open", coin: "HYPE", before: 0, after: 3, price: 40 },
      { kind: "close", coin: "DOGE", before: 5, after: 0, price: 1 },
    ]);
  });

  it("ignores unchanged positions and rounding noise", () => {
    expect(leaderEvents({ BTC: pos("BTC", 1) }, { BTC: pos("BTC", 1 + 1e-12, 100, 105) })).toEqual([]);
  });
});

describe("copyPlan", () => {
  const settings = { ...DEFAULT_COPY, enabled: true, usd: 200, maxUsd: 500 };

  it("opens at the fixed amount or a share of the leader, capped", () => {
    expect(copyPlan({ kind: "open", coin: "BTC", before: 0, after: -1, price: 100 }, settings, 0).steps).toEqual([{ action: "open", side: "sell", usd: 200 }]);
    expect(openUsd({ ...settings, sizing: "ratio", ratio: 10 }, 20, 100)).toBe(200);
    expect(openUsd({ ...settings, sizing: "ratio", ratio: 50 }, 20, 100)).toBe(500);
  });

  it("follows adds and reductions in proportion to the copy", () => {
    const add = copyPlan({ kind: "add", coin: "BTC", before: 1, after: 1.5, price: 100 }, settings, 2);
    expect(add.steps).toEqual([{ action: "open", side: "buy", size: 1 }]);
    const capped = copyPlan({ kind: "add", coin: "BTC", before: 1, after: 3, price: 100 }, settings, 2);
    expect(capped.steps).toEqual([{ action: "open", side: "buy", size: 3 }]);
    const reduce = copyPlan({ kind: "reduce", coin: "BTC", before: -4, after: -1, price: 100 }, settings, -2);
    expect(reduce.steps).toEqual([{ action: "reduce", side: "buy", size: 1.5 }]);
  });

  it("closes the whole copy and flips through a close", () => {
    expect(copyPlan({ kind: "close", coin: "BTC", before: 1, after: 0, price: 100 }, settings, 0.5).steps).toEqual([{ action: "reduce", side: "sell", size: 0.5 }]);
    expect(copyPlan({ kind: "flip", coin: "BTC", before: 1, after: -1, price: 100 }, settings, 0.5).steps).toEqual([
      { action: "reduce", side: "sell", size: 0.5 },
      { action: "open", side: "sell", usd: 200 },
    ]);
  });

  it("leaves positions from before copying alone and honours the coin list", () => {
    expect(copyPlan({ kind: "reduce", coin: "BTC", before: 2, after: 1, price: 100 }, settings, 0).steps).toEqual([]);
    const listed = { ...settings, coins: ["ETH"] };
    expect(copyPlan({ kind: "open", coin: "BTC", before: 0, after: 1, price: 100 }, listed, 0).note).toMatch(/copy list/);
    expect(copyPlan({ kind: "open", coin: "xyz:ETH", before: 0, after: 1, price: 100 }, listed, 0).steps).toHaveLength(1);
    expect(copyPlan({ kind: "close", coin: "BTC", before: 1, after: 0, price: 100 }, listed, 1).steps).toHaveLength(1);
  });
});

describe("follow lists", () => {
  it("normalizes a follow and its copy settings", () => {
    const follow = readFollow({ source: "hyperliquid", address: ADDRESS, label: "  Big   whale ", copy: { enabled: true, usd: -5, leverage: 99, target: "nope", coins: ["btc", "eth", "btc", "x y"] } });
    expect(follow).toMatchObject({ id: `hyperliquid:${ADDRESS.toLowerCase()}`, address: ADDRESS.toLowerCase(), label: "Big whale", notify: false });
    expect(follow?.copy).toMatchObject({ enabled: true, usd: 1, leverage: 50, target: "same", coins: ["BTC", "ETH"] });
    expect(readFollow({ source: "aster", address: ADDRESS })).toBeNull();
    expect(readFollow({ source: "lighter", address: "0x123" })).toBeNull();
  });

  it("drops duplicates and copies at most a few wallets at once", () => {
    const wallets = Array.from({ length: 8 }, (_, index) => ({ source: "hyperliquid", address: `0x${String(index).repeat(40)}`, copy: { enabled: true } }));
    const list = readFollows([...wallets, wallets[0]]);
    expect(list).toHaveLength(8);
    expect(list.filter((follow) => follow.copy.enabled)).toHaveLength(MAX_COPYING);
  });

  it("keeps only what alerts need on the server", () => {
    expect(readWatchedWallets([{ source: "lighter", address: ADDRESS, label: "x", copy: { enabled: true } }])).toEqual([{ source: "lighter", address: ADDRESS.toLowerCase(), label: "x" }]);
    expect(readWatchedWallets([{ source: "orderly", address: ADDRESS }])).toBeNull();
    expect(readWatchedWallets("nope")).toBeNull();
  });
});

describe("leader alerts", () => {
  const wallet = { source: "hyperliquid" as const, address: ADDRESS.toLowerCase(), label: "Whale" };
  it("says what the wallet did and links opens to the copy window", async () => {
    const { leaderMessage } = await import("./messages");
    const open = leaderMessage({ kind: "open", coin: "xyz:NVDA", before: 0, after: -10, price: 180 }, wallet, "https://trade.angler.network");
    expect(open).toContain("🐋 Whale opened short 10 NVDA on Hyperliquid");
    expect(open).toContain("https://trade.angler.network/copy?follow=hyperliquid%3A0xabcdef");
    expect(open).toContain("coin=xyz%3ANVDA&side=short");
    const close = leaderMessage({ kind: "close", coin: "BTC", before: 1, after: 0, price: 100 }, { ...wallet, label: "" }, "https://x.y");
    expect(close).toMatch(/^🐋 0xabcd…ef01 closed long 1 BTC on Hyperliquid/);
    expect(close).not.toContain("/copy");
  });
});
