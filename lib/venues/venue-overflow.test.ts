import { describe, expect, it } from "vitest";
import { splitVenues } from "./venue-overflow";

describe("splitVenues", () => {
  it("shows every venue while they fit", () => {
    expect(splitVenues(["a", "b", "c"])).toEqual({ shown: ["a", "b", "c"], hidden: [] });
    expect(splitVenues(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b", "c", "d"], hidden: [] });
  });

  it("keeps three logos and folds the rest, in order", () => {
    expect(splitVenues(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], hidden: ["d", "e"] });
    expect(splitVenues(["a", "b", "c", "d", "e", "f", "g", "h"])).toEqual({ shown: ["a", "b", "c"], hidden: ["d", "e", "f", "g", "h"] });
  });

  it("handles none", () => {
    expect(splitVenues([])).toEqual({ shown: [], hidden: [] });
  });
});
