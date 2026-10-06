import { describe, expect, it } from "vitest";
import { notificationContent } from "./notify";

describe("notificationContent", () => {
  it("leads with severity, assets and the sentiment", () => {
    expect(
      notificationContent({ headline: "ETF inflows", severity: "breaking", score: 91, coins: ["BTC", "ETH", "SOL", "XRP"], sentiment: 0.6, hasSentiment: true }),
    ).toEqual({ title: "Breaking · BTC, ETH, SOL · Bullish", body: "ETF inflows (impact 91)" });
  });

  it("skips unknown sentiment and missing assets", () => {
    expect(notificationContent({ headline: "Fed minutes", severity: "important", score: 70, sentiment: 0, hasSentiment: false }).title).toBe("Important");
  });
});
