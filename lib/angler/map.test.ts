import { describe, expect, it } from "vitest";
import { mergeApiNews, readApiNews, readNewsPage, severityFor, toNewsItem } from "./map";

describe("readApiNews", () => {
  it("reads the documented fields", () => {
    const news = readApiNews({
      id: "n1",
      headline: "Hello",
      source: "Reuters",
      coins: ["btcusdt", "xyz:NVDA"],
      sentiment: 0.4,
      importance_score: 81,
      summary_short: "Short",
      impact_predictions: [{ symbol: "BTC", direction: "+", magnitude: 70, confidence: 80 }],
    });
    expect(news).toMatchObject({ id: "n1", headline: "Hello", source: "Reuters", coins: ["BTC", "NVDA"], importance_score: 81 });
    expect(news?.impact_predictions?.[0].confidence).toBe(0.8);
  });

  it("accepts source objects, alternative names and falls back to the article domain", () => {
    expect(readApiNews({ id: 1, title: "T", source: { name: "Bloomberg" } })?.source).toBe("Bloomberg");
    expect(readApiNews({ id: 2, title: "T", source_name: "CoinDesk" })?.source).toBe("CoinDesk");
    expect(readApiNews({ id: 3, title: "T", link: "https://www.theblock.co/post/1" })).toMatchObject({ source: "theblock.co", url: "https://www.theblock.co/post/1" });
    expect(readApiNews({ id: 4, title: "T", tags: ["etf"] })?.categories).toEqual(["etf"]);
  });

  it("rejects items without id or headline", () => {
    expect(readApiNews({ id: "x" })).toBeNull();
    expect(readApiNews({ headline: "x" })).toBeNull();
  });
});

describe("raw → enriched upsert", () => {
  it("keeps enrichment when a late raw duplicate arrives", () => {
    const raw = readApiNews({ id: "a", headline: "H", published_at: "2026-10-05T10:00:00Z" })!;
    const enriched = readApiNews({ id: "a", headline: "H", importance_score: 90, coins: ["SOL"] })!;
    const merged = mergeApiNews(mergeApiNews(raw, enriched), raw);
    expect(merged).toMatchObject({ importance_score: 90, coins: ["SOL"], published_at: "2026-10-05T10:00:00Z" });
    expect(toNewsItem(merged).enriched).toBe(true);
  });
});

describe("mapping to NewsItem", () => {
  it("leads with the strongest prediction and derives severity", () => {
    const item = toNewsItem(
      readApiNews({
        id: "b",
        headline: "H",
        importance_score: 65,
        coins: ["ETH"],
        impact_predictions: [
          { symbol: "ETH", direction: "+", magnitude: 30, confidence: 0.5 },
          { symbol: "SOL", direction: "-", magnitude: 80, confidence: 0.9 },
        ],
      })!,
    );
    expect(item).toMatchObject({ symbol: "SOL", direction: "down", severity: "important", coins: ["SOL", "ETH"] });
    expect(severityFor(80)).toBe("breaking");
    expect(severityFor(59)).toBe("notable");
  });

  it("reads pages in several envelope shapes", () => {
    expect(readNewsPage({ items: [{ id: 1, headline: "a" }], next_cursor: "c" })).toMatchObject({ next_cursor: "c" });
    expect(readNewsPage({ data: [{ id: 1, headline: "a" }] }).items).toHaveLength(1);
    expect(readNewsPage([{ id: 1, headline: "a" }]).items).toHaveLength(1);
  });
});
