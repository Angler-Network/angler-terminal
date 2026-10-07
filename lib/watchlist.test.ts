import { describe, expect, it } from "vitest";
import { MAX_WATCHLIST, readWatchlist, toggleWatch, type WatchlistEntry } from "./watchlist";

const btc: WatchlistEntry = { id: "perp:BTC", kind: "perp", symbol: "BTC", asset: "BTC" };
const wbtc: WatchlistEntry = {
  id: "jupiter:3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  kind: "spot",
  symbol: "WBTC",
  asset: "BTC",
  name: "Wrapped BTC (Portal)",
  icon: "https://example.com/wbtc.png",
  mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
};

describe("readWatchlist", () => {
  it("keeps valid entries once each", () => {
    expect(readWatchlist([btc, wbtc, btc])).toEqual([btc, wbtc]);
  });

  it("drops malformed entries and unsafe fields", () => {
    const list = readWatchlist([
      { ...btc, kind: "futures" },
      { ...btc, id: "perp:ETH", asset: "eth<script>" },
      { ...wbtc, icon: "javascript:alert(1)", mint: "not a mint" },
      "nope",
    ]);
    expect(list).toEqual([{ id: wbtc.id, kind: "spot", symbol: "WBTC", asset: "BTC", name: wbtc.name }]);
    expect(readWatchlist(undefined)).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_WATCHLIST + 5 }, (_, index) => ({ ...btc, id: `perp:A${index}`, asset: `A${index}` }));
    expect(readWatchlist(many)).toHaveLength(MAX_WATCHLIST);
  });
});

describe("toggleWatch", () => {
  it("adds first and removes on a second toggle", () => {
    const added = toggleWatch([btc], wbtc);
    expect(added.map((entry) => entry.id)).toEqual([wbtc.id, btc.id]);
    expect(toggleWatch(added, wbtc)).toEqual([btc]);
  });
});
