import { describe, expect, it } from "vitest";
import { marketCategory } from "./category";

describe("marketCategory", () => {
  it("sorts the stock dex's mixed listings into their classes", () => {
    expect(marketCategory("NVDA", "stock")).toBe("stocks");
    expect(marketCategory("GOLD", "stock")).toBe("commodities");
    expect(marketCategory("SP500", "stock")).toBe("indices");
    expect(marketCategory("JPY", "stock")).toBe("fx");
    expect(marketCategory("SPCX", "stock")).toBe("preipo");
  });

  it("classifies Lighter markets that come labelled crypto", () => {
    expect(marketCategory("EURUSD", "crypto")).toBe("fx");
    expect(marketCategory("USDJPY", "crypto")).toBe("fx");
    expect(marketCategory("XAU", "crypto")).toBe("commodities");
    expect(marketCategory("OPENAI", "crypto")).toBe("preipo");
    expect(marketCategory("BTC", "crypto")).toBe("crypto");
    // Crypto tickers that only look like FX stay crypto.
    expect(marketCategory("USDC", "crypto")).toBe("crypto");
    expect(marketCategory("SUSD", "crypto")).toBe("crypto");
  });
});
