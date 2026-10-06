import { describe, expect, it } from "vitest";
import { freshKeys, motion } from "./motion";

describe("freshKeys", () => {
  it("never animates the first render", () => {
    expect(freshKeys(null, ["a", "b"])).toEqual([]);
  });

  it("returns keys that weren't there before, in list order", () => {
    expect(freshKeys(new Set(["b"]), ["c", "a", "b"])).toEqual(["c", "a"]);
  });

  it("skips bursts larger than the limit", () => {
    expect(freshKeys(new Set(), ["a", "b", "c"], 2)).toEqual([]);
    expect(freshKeys(new Set(), ["a", "b"], 2)).toEqual(["a", "b"]);
  });
});

describe("motion", () => {
  it("is off until GSAP has loaded", () => {
    expect(motion()).toBeNull();
  });
});
