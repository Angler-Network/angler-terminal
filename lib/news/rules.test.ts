import { describe, expect, it } from "vitest";
import { describeRule, matchRule, matchRules, newsDirection, readNewsRules, type NewsRule } from "./rules";

const rule = (patch: Partial<NewsRule>): NewsRule => ({
  id: "r1",
  enabled: true,
  asset: "*",
  minImpact: 60,
  sentiment: "any",
  action: "alert",
  sizeUsd: 0,
  auto: false,
  ...patch,
});

const item = (patch: Record<string, unknown> = {}) => ({
  enriched: true,
  score: 85,
  coins: ["BTC", "ETH"],
  sentiment: -0.6,
  hasSentiment: true,
  predictions: [] as { symbol: string; direction: "+" | "-"; magnitude: number }[],
  ...patch,
});

describe("news rules", () => {
  it("matches impact and asset, first asset only for alerts and trades", () => {
    expect(matchRule(rule({}), item(), {}).map((match) => match.symbol)).toEqual(["BTC"]);
    expect(matchRule(rule({ asset: "ETH" }), item(), {}).map((match) => match.symbol)).toEqual(["ETH"]);
    expect(matchRule(rule({ minImpact: 90 }), item(), {})).toEqual([]);
    expect(matchRule(rule({ enabled: false }), item(), {})).toEqual([]);
    expect(matchRule(rule({}), item({ enriched: false }), {})).toEqual([]);
  });

  it("reads direction from the asset's prediction before the sentiment", () => {
    const withPrediction = item({ predictions: [{ symbol: "ETH", direction: "+", magnitude: 50 }] });
    expect(newsDirection(withPrediction, "ETH")).toBe(1);
    expect(newsDirection(withPrediction, "BTC")).toBe(-1);
    expect(newsDirection(item({ hasSentiment: false, sentiment: 0 }), "BTC")).toBe(0);
    expect(matchRule(rule({ sentiment: "positive" }), withPrediction, {}).map((match) => match.symbol)).toEqual(["ETH"]);
  });

  it("needs a direction for sentiment rules (REST items have none)", () => {
    expect(matchRule(rule({ sentiment: "negative" }), item({ hasSentiment: false, sentiment: 0 }), {})).toEqual([]);
  });

  it("targets held positions: adverse news and close actions", () => {
    const positions = { BTC: "long" as const, ETH: "short" as const };
    // Bearish news is adverse to the BTC long, not to the ETH short.
    expect(matchRule(rule({ asset: "positions", sentiment: "adverse", action: "close" }), item(), positions)).toEqual([
      { rule: expect.anything(), symbol: "BTC", position: "long" },
    ]);
    // Close fires once per held asset.
    expect(matchRule(rule({ action: "close" }), item(), positions).map((match) => match.symbol)).toEqual(["BTC", "ETH"]);
    expect(matchRule(rule({ action: "close" }), item(), {})).toEqual([]);
    expect(matchRule(rule({ asset: "positions" }), item(), {})).toEqual([]);
    expect(matchRules([rule({}), rule({ id: "r2", asset: "ETH" })], item(), {})).toHaveLength(2);
  });

  it("validates saved rules", () => {
    const saved = readNewsRules([
      { id: "a", enabled: true, asset: "btc", minImpact: 120, sentiment: "negative", action: "short", sizeUsd: 25.555, auto: true },
      { id: "b", asset: "positions", minImpact: 70, sentiment: "adverse", action: "close" },
      { id: "c", asset: "*", minImpact: 70, sentiment: "sideways", action: "alert" },
      { id: "d", asset: "B T C", minImpact: 70, sentiment: "any", action: "alert" },
      null,
    ]);
    expect(saved).toEqual([
      { id: "a", enabled: true, asset: "BTC", minImpact: 100, sentiment: "negative", action: "short", sizeUsd: 25.56, auto: true },
      { id: "b", enabled: true, asset: "positions", minImpact: 70, sentiment: "adverse", action: "close", sizeUsd: 0, auto: false },
    ]);
    expect(readNewsRules("x")).toEqual([]);
  });

  it("describes rules in one line", () => {
    expect(describeRule(rule({ asset: "BTC", sentiment: "negative", action: "close", minImpact: 80 }))).toBe(
      "Bearish news on BTC, impact 80+ → close the position (asks first)",
    );
    expect(describeRule(rule({ action: "long", sizeUsd: 50, auto: true }))).toBe("News on any asset, impact 60+ → long $50 (automatic)");
  });
});
