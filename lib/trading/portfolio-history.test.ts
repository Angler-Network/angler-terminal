import { describe, expect, it } from "vitest";
import { dailyPnl, fillTotals, rebase, fromHlFill, fromLighterTrade, hlPnlSeries, lighterPnlSeries, windowPnl } from "./portfolio-history";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 6, 15);
const today = Date.UTC(2026, 9, 6);

describe("pnl series", () => {
  it("rebases Hyperliquid history to the window start", () => {
    const series = hlPnlSeries(
      [
        [today - 5 * DAY, "100"],
        [today - 2 * DAY, "130"],
        [today, "90.5"],
      ],
      today - 3 * DAY,
    );
    expect(series).toEqual([
      { time: today - 2 * DAY, pnl: 0 },
      { time: today, pnl: -39.5 },
    ]);
  });

  it("rebases Lighter cumulative trade pnl (seconds) and sorts it", () => {
    const series = lighterPnlSeries(
      [
        { timestamp: today / 1000, trade_pnl: 25 },
        { timestamp: (today - DAY) / 1000, trade_pnl: 10 },
      ],
      0,
    );
    expect(series).toEqual([
      { time: today - DAY, pnl: 0 },
      { time: today, pnl: 15 },
    ]);
  });

  it("sums venues per day with forward fill, and totals the window", () => {
    const hl = [
      { time: today - 2 * DAY + 1000, pnl: 0 },
      { time: today - DAY + 1000, pnl: 20 },
    ];
    const lighter = [{ time: today + 1000, pnl: -5 }];
    expect(dailyPnl([hl, lighter], 3, now)).toEqual([
      { time: today - 2 * DAY, pnl: 0 },
      { time: today - DAY, pnl: 20 },
      { time: today, pnl: 15 },
    ]);
    expect(windowPnl([hl, lighter])).toBe(15);
    expect(windowPnl([])).toBe(0);
  });

  it("narrows a series to a shorter window", () => {
    const series = [
      { time: 1, pnl: 0 },
      { time: 5, pnl: 10 },
      { time: 9, pnl: 4 },
    ];
    expect(rebase(series, 6)).toEqual([{ time: 9, pnl: -6 }]);
  });
});

describe("fills", () => {
  it("maps Hyperliquid fills, realized PnL only on closes", () => {
    const base = { coin: "xyz:NVDA", px: "200", sz: "2", time: 1, fee: "0.18", tid: 7 };
    const open = fromHlFill({ ...base, side: "B", dir: "Open Long", closedPnl: "0" }, (coin) => coin.split(":").at(-1)!);
    expect(open).toMatchObject({ id: "hyperliquid:7", symbol: "NVDA", side: "buy", usd: 400, fee: 0.18, realizedPnl: null });
    const close = fromHlFill({ ...base, side: "A", dir: "Close Long", closedPnl: "-3.5" }, (coin) => coin);
    expect(close).toMatchObject({ side: "sell", realizedPnl: -3.5, direction: "Close Long" });
  });

  it("maps Lighter trades from the account's side", () => {
    const trade = { trade_id: 9, market_id: 1, size: "0.5", price: "60000", usd_amount: "30000", bid_account_id: 42, ask_account_id: 7, timestamp: 5 };
    expect(fromLighterTrade(trade, 42, () => "BTC")).toMatchObject({ venue: "lighter", side: "buy", usd: 30000, symbol: "BTC", fee: null });
    expect(fromLighterTrade(trade, 7, () => "BTC").side).toBe("sell");
  });

  it("totals volume, fees and realized PnL", () => {
    const fill = fromHlFill({ coin: "BTC", px: "100", sz: "1", side: "A", time: 1, dir: "Close Long", closedPnl: "5", fee: "0.1", tid: 1 }, (c) => c);
    expect(fillTotals([fill, { ...fill, fee: null, realizedPnl: null }])).toEqual({ volume: 200, fees: 0.1, realizedPnl: 5, count: 2 });
  });
});
