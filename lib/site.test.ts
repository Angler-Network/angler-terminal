import { describe, expect, it } from "vitest";
import { isIndexable, siteUrl } from "./site";

describe("site", () => {
  it("indexes both sites but not dev builds", () => {
    expect(isIndexable("mainnet")).toBe(true);
    expect(isIndexable("testnet")).toBe(true);
    expect(isIndexable(null)).toBe(false);
  });

  it("picks the canonical origin", () => {
    expect(siteUrl("mainnet", undefined)).toBe("https://trade.angler.network");
    expect(siteUrl("testnet", undefined)).toBe("https://testnet-trade.angler.network");
    expect(siteUrl(null, undefined)).toBe("http://localhost:3000");
    expect(siteUrl("mainnet", "https://example.com/")).toBe("https://example.com");
    expect(siteUrl("mainnet", "not a url")).toBe("https://trade.angler.network");
  });
});
