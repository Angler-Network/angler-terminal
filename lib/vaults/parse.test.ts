import { describe, expect, it } from "vitest";
import hlDetails from "./fixtures/hl-vault-details.json";
import hlVaults from "./fixtures/hl-vaults.json";
import lighterPnl from "./fixtures/lighter-pnl.json";
import lighterPools from "./fixtures/lighter-pools.json";
import orderlyPerformance from "./fixtures/orderly-performance.json";
import orderlyVaults from "./fixtures/orderly-vaults.json";
import { hlHistory, lighterHistory, lighterNextIndex, orderlyHistory, readHlStakes, readHlVaults, readLighterPools, readLighterStakes, readOrderlyVaults, summarize } from "./parse";

const DAY = 86_400_000;

describe("readHlVaults", () => {
  const rows = readHlVaults(hlVaults, "https://app.hyperliquid.xyz");
  it("keeps open vaults above the floor, drops HLP's children, closed and tiny ones", () => {
    expect(rows.map((row) => row.name)).toEqual(["Hyperliquidity Provider (HLP)", "Growi HF", "[ Systemic Strategies ] L/S Grids", "Prosper Intelligence"]);
  });
  it("marks HLP as the protocol's vault with no leader share and a 4-day lock", () => {
    const hlp = rows[0];
    expect(hlp).toMatchObject({ venue: "hyperliquid", kind: "protocol", profitShare: 0, lockHours: 96, open: true });
    expect(hlp.id).toBe("0xdfc24b077bc1425ad1dea75bcb6f8158e10df303");
    expect(hlp.url).toBe("https://app.hyperliquid.xyz/vaults/0xdfc24b077bc1425ad1dea75bcb6f8158e10df303");
    expect(hlp.tvl).toBeGreaterThan(1e8);
    expect(hlp.apr).toBeCloseTo(0.0395, 3);
  });
  it("gives user vaults the 10% leader share and a 1-day lock", () => {
    expect(rows[1]).toMatchObject({ kind: "user", profitShare: 0.1, lockHours: 24 });
    expect(rows[1].createdAt).toBeGreaterThan(1.6e12);
  });
  it("answers nothing for a malformed list", () => {
    expect(readHlVaults({}, "x")).toEqual([]);
    expect(readHlVaults([{ summary: { vaultAddress: "nope", tvl: "5000" } }], "x")).toEqual([]);
  });
});

describe("hlHistory", () => {
  const week = hlDetails.portfolio.find((entry) => entry[0] === "week")![1] as { accountValueHistory: Array<Array<string | number>> };
  const last = Number(week.accountValueHistory.at(-1)![0]);
  const history = hlHistory(hlDetails, last);
  it("stitches all time, month and week into one growth index starting at 1", () => {
    expect(history.points[0][1]).toBeGreaterThan(0);
    const times = history.points.map(([t]) => t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(history.points.at(-1)![0]).toBe(last);
  });
  it("matches HLP's month: PnL over the value it started with", () => {
    // HLP: ~641k PnL on ~180M over the month, deposits and withdrawals aside.
    expect(history.returns.d30).toBeGreaterThan(0);
    expect(history.returns.d30).toBeLessThan(0.02);
    expect(history.returns.d7).not.toBeNull();
  });
  it("counts deposits during a step as half-time capital, not as gains (Modified Dietz)", () => {
    // $100 grows to $160: $10 of PnL and $50 deposited along the way, so $10 on $125 of capital.
    const window = { accountValueHistory: [[0, "100"], [DAY, "160"]], pnlHistory: [[0, "0"], [DAY, "10"]] };
    const result = hlHistory({ portfolio: [["allTime", window]] }, DAY);
    expect(result.points.at(-1)![1]).toBeCloseTo(1.08);
  });
  it("reports a drawdown between 0 and 1", () => {
    expect(history.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(history.maxDrawdown).toBeLessThan(1);
  });
});

describe("readLighterPools", () => {
  const rows = readLighterPools(lighterPools, "lighter", "https://app.lighter.xyz");
  it("keeps LLP and drops the pools under the floor", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ venue: "lighter", kind: "protocol", manager: null, id: "281474976710654", profitShare: 0 });
    expect(rows[0].url).toBe("https://app.lighter.xyz/public-pools/281474976710654");
  });
  it("turns the percentage APY into a fraction and prices a share", () => {
    expect(rows[0].apr).toBeCloseTo(0.1535, 3);
    expect(rows[0].sharePrice).toBeGreaterThan(0);
  });
  it("reads the next page's cursor", () => {
    expect(lighterNextIndex(lighterPools)).toBe(281474976710651);
    expect(lighterNextIndex({ public_pools: [] })).toBeNull();
  });
});

describe("lighterHistory", () => {
  const rows = lighterPnl.pnl;
  const history = lighterHistory(lighterPnl, rows.at(-1)!.timestamp * 1000);
  it("follows the share price: value (inflow - outflow + trade PnL) over shares", () => {
    const first = rows[0];
    const lastRow = rows.at(-1)!;
    const price = (row: typeof first) => (row.inflow - row.outflow + row.trade_pnl) / row.pool_total_shares;
    expect(history.points[0][1]).toBe(1);
    expect(history.points.at(-1)![1]).toBeCloseTo(price(lastRow) / price(first), 10);
  });
  it("has a 7-day return but no 90-day one from 12 days of history", () => {
    expect(history.returns.d7).not.toBeNull();
    expect(history.returns.d90).toBeNull();
  });
});

describe("readOrderlyVaults / orderlyHistory", () => {
  it("keeps live vaults above the floor with their fee, lock and minimum", () => {
    const rows = readOrderlyVaults(orderlyVaults, "https://app.orderly.network/vaults");
    expect(rows.map((row) => row.name)).toEqual(["Orderly OmniVault", "Smaug"]);
    expect(rows[0]).toMatchObject({ kind: "protocol", profitShare: 0, lockHours: 48, minDeposit: 10, manager: "Vovega" });
    expect(rows[1]).toMatchObject({ kind: "user", profitShare: 0.3, lockHours: 168 });
  });
  it("uses the all-time drawdown and lists each period", () => {
    const history = orderlyHistory(orderlyPerformance);
    expect(history.maxDrawdown).toBe(0.0848);
    expect(history.periods?.map((period) => period.range)).toEqual(["24h", "7d", "30d", "all_time"]);
  });
});

describe("summarize", () => {
  const now = 400 * DAY;
  it("measures returns and the largest fall from a peak", () => {
    const points: Array<[number, number]> = [
      [now - 100 * DAY, 1],
      [now - 40 * DAY, 1.2],
      [now - 20 * DAY, 0.9],
      [now, 1.08],
    ];
    const result = summarize(points, now);
    expect(result.returns.d90).toBeCloseTo(0.08);
    expect(result.returns.d30).toBeCloseTo(1.08 / 1.2 - 1);
    expect(result.returns.y1).toBeNull();
    expect(result.maxDrawdown).toBeCloseTo(0.25);
  });
  it("answers nulls for an empty history", () => {
    expect(summarize([], now)).toEqual({ points: [], returns: { d7: null, d30: null, d90: null, y1: null }, maxDrawdown: null });
  });
});

describe("wallet stakes", () => {
  it("reads Hyperliquid vault equities, skipping empty ones", () => {
    const stakes = readHlStakes([
      { vaultAddress: "0xDFC24B077BC1425AD1DEA75BCB6F8158E10DF303", equity: "605156.8075549999", lockedUntilTimestamp: 1770680880422 },
      { vaultAddress: "0x0000000000000000000000000000000000000001", equity: "0.0", lockedUntilTimestamp: 0 },
    ]);
    expect(stakes).toEqual([{ venue: "hyperliquid", id: "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303", value: 605156.8075549999, entry: null, lockedUntil: 1770680880422 }]);
  });
  it("adds up Lighter pool shares across accounts and values them at the share price", () => {
    const raw = {
      accounts: [
        { account_index: 1, shares: [{ public_pool_index: 281474976710654, shares_amount: 1000, entry_usdc: "300.5" }] },
        { account_index: 2, shares: [{ public_pool_index: 281474976710654, shares_amount: 500, entry_usdc: "150" }] },
        { account_index: 3, shares: [] },
      ],
    };
    const stakes = readLighterStakes(raw, "lighter", (id) => (id === "281474976710654" ? 0.4 : undefined));
    expect(stakes).toEqual([{ venue: "lighter", id: "281474976710654", value: 600, entry: 450.5, lockedUntil: null, shares: { 1: 1000, 2: 500 } }]);
    expect(readLighterStakes({ accounts: [{ shares: [] }] }, "lighter", () => 1)).toEqual([]);
  });
});
