import { describe, expect, it } from "vitest";
import { bookSources, toggleBookSource } from "./book-sources";

const listed = ["hl", "lighter", "rh", "aster", "orderly", "extended"];

describe("bookSources", () => {
  it("merges the first three by default", () => {
    expect(bookSources(listed, null)).toEqual(["hl", "lighter", "rh"]);
    expect(bookSources(["hl"], null)).toEqual(["hl"]);
  });

  it("keeps the picked venues in the listed order", () => {
    expect(bookSources(listed, ["orderly", "hl"])).toEqual(["hl", "orderly"]);
  });

  it("falls back to the default when no picked venue lists the asset", () => {
    expect(bookSources(["hl", "lighter"], ["aster"])).toEqual(["hl", "lighter"]);
    expect(bookSources(["hl", "lighter", "aster"], ["aster", "orderly"])).toEqual(["aster"]);
  });

  it("shows every venue when all are picked", () => {
    expect(bookSources(listed, listed)).toEqual(listed);
    expect(bookSources([...listed, "seventh"], [...listed, "seventh"])).toEqual(listed);
  });
});

describe("toggleBookSource", () => {
  it("adds and removes", () => {
    expect(toggleBookSource(["hl"], "aster")).toEqual(["hl", "aster"]);
    expect(toggleBookSource(["hl", "aster"], "hl")).toEqual(["aster"]);
  });

  it("keeps the last venue and the cap", () => {
    expect(toggleBookSource(["hl"], "hl")).toEqual(["hl"]);
    expect(toggleBookSource(["a", "b", "c", "d", "e"], "f")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(toggleBookSource(["a", "b", "c", "d", "e", "f"], "g")).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
