import { describe, expect, it } from "vitest";
import { pickBestSpotQuote } from "./best-quote";

const quote = (name: string, outAmount: bigint, transaction: string | null = "tx", error?: string) => ({ name, outAmount, transaction, error });

describe("pickBestSpotQuote", () => {
  it("takes the executable quote with the most output, Jupiter first on ties", () => {
    expect(pickBestSpotQuote([quote("jupiter", 100n), quote("titan", 101n)])?.name).toBe("titan");
    expect(pickBestSpotQuote([quote("jupiter", 100n), quote("titan", 100n)])?.name).toBe("jupiter");
  });

  it("skips missing, unsignable and failed quotes", () => {
    expect(pickBestSpotQuote([quote("jupiter", 100n, null, "no route"), quote("titan", 90n)])?.name).toBe("titan");
    expect(pickBestSpotQuote([quote("jupiter", 100n), null])?.name).toBe("jupiter");
    expect(pickBestSpotQuote([null, quote("titan", 1n, null)])).toBeNull();
  });
});
