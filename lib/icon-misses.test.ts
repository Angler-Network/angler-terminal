import { describe, expect, it } from "vitest";
import { ICON_MISS_TTL_MS, readIconMisses, serializeIconMisses } from "./icon-misses";

describe("icon misses", () => {
  const now = 1_000_000_000_000;

  it("keeps fresh entries and drops expired or malformed ones", () => {
    const raw = JSON.stringify({ a: now - 1000, b: now - ICON_MISS_TTL_MS - 1, c: "x", d: now + 60_000 });
    expect([...readIconMisses(raw, now).keys()]).toEqual(["a"]);
  });

  it("reads garbage as no misses", () => {
    expect(readIconMisses("{oops", now).size).toBe(0);
    expect(readIconMisses("[1,2]", now).size).toBe(0);
    expect(readIconMisses(null, now).size).toBe(0);
  });

  it("keeps only the newest entries", () => {
    const misses = new Map([
      ["old", now - 3000],
      ["new", now - 1000],
      ["mid", now - 2000],
    ]);
    expect(Object.keys(JSON.parse(serializeIconMisses(misses, 2)))).toEqual(["new", "mid"]);
  });
});
