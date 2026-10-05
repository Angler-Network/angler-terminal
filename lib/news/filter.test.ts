import { describe, expect, it } from "vitest";
import { countActiveFilters, defaultNewsFilters, filterNews, sentimentOf } from "./filter";

const item = (id: string, over: Partial<{ enriched: boolean; coins: string[]; sentiment: number; severity: "breaking" | "important" | "notable"; score: number }> = {}) => ({
  id,
  enriched: true,
  coins: ["BTC"],
  sentiment: 0.5,
  severity: "important" as const,
  score: 70,
  ...over,
});

const items = [
  item("btc-bull"),
  item("eth-bear", { coins: ["ETH"], sentiment: -0.6, severity: "breaking", score: 90 }),
  item("sol-flat", { coins: ["SOL"], sentiment: 0.05, severity: "notable", score: 30 }),
  item("raw", { enriched: false, coins: [], score: 0, sentiment: 0 }),
];
const ids = (list: { id: string }[]) => list.map((entry) => entry.id);

describe("filterNews", () => {
  it("passes everything with the defaults", () => {
    expect(ids(filterNews(items, defaultNewsFilters))).toEqual(["btc-bull", "eth-bear", "sol-flat", "raw"]);
    expect(countActiveFilters(defaultNewsFilters)).toBe(0);
  });

  it("filters by asset and hides raw items when assets are restricted", () => {
    expect(ids(filterNews(items, { ...defaultNewsFilters, assets: ["btc"] }))).toEqual(["btc-bull"]);
  });

  it("filters by sentiment, severity and impact", () => {
    expect(ids(filterNews(items, { ...defaultNewsFilters, sentiments: ["bearish"] }))).toEqual(["eth-bear", "raw"]);
    expect(ids(filterNews(items, { ...defaultNewsFilters, severities: ["breaking", "important"], showRaw: false }))).toEqual(["btc-bull", "eth-bear"]);
    expect(ids(filterNews(items, { ...defaultNewsFilters, minImpact: 60, showRaw: false }))).toEqual(["btc-bull", "eth-bear"]);
  });

  it("applies a ticker focus on top of the saved filters", () => {
    expect(ids(filterNews(items, defaultNewsFilters, "ETH"))).toEqual(["eth-bear"]);
    expect(ids(filterNews(items, { ...defaultNewsFilters, sentiments: ["bullish"] }, "ETH"))).toEqual([]);
  });

  it("counts active filters and reads sentiment bands", () => {
    expect(countActiveFilters({ ...defaultNewsFilters, assets: ["BTC"], minImpact: 40, showRaw: false })).toBe(3);
    expect(sentimentOf(0.15)).toBe("bullish");
    expect(sentimentOf(0.1)).toBe("neutral");
    expect(sentimentOf(-0.2)).toBe("bearish");
  });
});
