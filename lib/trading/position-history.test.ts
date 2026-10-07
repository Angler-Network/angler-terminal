import { describe, expect, it } from "vitest";
import type { HistoryFill } from "./portfolio-history";
import { positionHistory } from "./position-history";

let id = 0;
const fill = (time: number, side: "buy" | "sell", size: number, price: number, extra: Partial<HistoryFill> = {}): HistoryFill => ({
  id: String(id++),
  venue: "lighter",
  time,
  symbol: "ETH",
  side,
  size,
  price,
  usd: size * price,
  fee: null,
  realizedPnl: null,
  direction: null,
  ...extra,
});

describe("positionHistory", () => {
  it("rebuilds a long that was added to and closed in two steps", () => {
    const [position] = positionHistory(
      [fill(1, "buy", 1, 100), fill(2, "buy", 1, 110), fill(3, "sell", 1, 120), fill(4, "sell", 1, 130)],
      [],
    );
    expect(position).toMatchObject({ side: "long", size: 2, entryPrice: 105, exitPrice: 125, openedAt: 1, closedAt: 4, pnl: 40, fees: null });
  });

  it("uses the venue's realized PnL and fees when it reports them", () => {
    const [position] = positionHistory(
      [
        fill(1, "sell", 2, 100, { venue: "hyperliquid", fee: 0.1, realizedPnl: 0 }),
        fill(2, "buy", 2, 90, { venue: "hyperliquid", fee: 0.1, realizedPnl: 19.5 }),
      ],
      [],
    );
    expect(position).toMatchObject({ venue: "hyperliquid", side: "short", entryPrice: 100, exitPrice: 90, pnl: 19.5, fees: 0.2 });
  });

  it("splits a flip into a closed position and a new one", () => {
    const closed = positionHistory([fill(1, "buy", 1, 100), fill(2, "sell", 3, 110)], [{ venue: "lighter", symbol: "ETH", size: -2 }]);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ side: "long", size: 1, entryPrice: 100, exitPrice: 110, pnl: 10 });
  });

  it("leaves the still open position out", () => {
    expect(positionHistory([fill(1, "buy", 1, 100)], [{ venue: "lighter", symbol: "ETH", size: 1 }])).toEqual([]);
  });

  it("marks positions opened before the window instead of inventing an entry", () => {
    // Now flat, and the window only saw the close: 1 ETH was already open when it started.
    const [position] = positionHistory([fill(5, "sell", 1, 120)], []);
    expect(position).toMatchObject({ side: "long", size: 1, entryPrice: null, openedAt: null, exitPrice: 120, pnl: null });
  });

  it("trusts the venue's start position over the current-minus-window estimate", () => {
    // The venue cut the window short: the fills alone would say "opened in the window", startPosition knows better.
    const [position] = positionHistory([fill(5, "sell", 1, 120, { venue: "hyperliquid", startPosition: 1, realizedPnl: 3 })], [{ venue: "hyperliquid", symbol: "ETH", size: 5 }]);
    expect(position).toMatchObject({ side: "long", entryPrice: null, openedAt: null, pnl: 3 });
  });

  it("rounds floating noise away", () => {
    const [position] = positionHistory([fill(1, "buy", 0.1, 10), fill(2, "buy", 0.2, 10), fill(3, "sell", 0.3, 11)], []);
    expect(position.size).toBe(0.3);
  });

  it("keeps venues and symbols apart and lists the newest first", () => {
    const closed = positionHistory(
      [fill(1, "buy", 1, 10, { symbol: "SOL" }), fill(2, "sell", 1, 11, { symbol: "SOL" }), fill(3, "buy", 1, 100), fill(4, "sell", 1, 99)],
      [],
    );
    expect(closed.map((position) => [position.symbol, position.pnl])).toEqual([
      ["ETH", -1],
      ["SOL", 1],
    ]);
  });
});
