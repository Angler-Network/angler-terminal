import { describe, expect, it } from "vitest";
import { detectHighImpact, FRESH_WINDOW_MS, isTypingTarget } from "./high-impact";

const NOW = 1_000_000_000;
const item = (id: string, score: number, enriched = true, ageMs = 0) => ({ id, score, enriched, publishedAt: NOW - ageMs });

describe("detectHighImpact", () => {
  it("stays quiet on the first load", () => {
    const { known, fresh } = detectHighImpact(null, [item("a", 95)], 80, NOW);
    expect(fresh).toEqual([]);
    expect(known.has("a")).toBe(true);
  });

  it("flashes new items at or above the threshold once", () => {
    let known = detectHighImpact(null, [], 80, NOW).known;
    const first = detectHighImpact(known, [item("b", 80), item("c", 79)], 80, NOW);
    expect(first.fresh).toEqual(["b"]);
    known = first.known;
    expect(detectHighImpact(known, [item("b", 80)], 80, NOW).fresh).toEqual([]);
  });

  it("flashes when enrichment pushes a raw item over the threshold", () => {
    const known = detectHighImpact(null, [item("d", 0, false)], 80, NOW).known;
    expect(detectHighImpact(known, [item("d", 0, false)], 80, NOW).fresh).toEqual([]);
    expect(detectHighImpact(known, [item("d", 91, true)], 80, NOW).fresh).toEqual(["d"]);
  });

  it("ignores old items loaded later", () => {
    const known = detectHighImpact(null, [], 80, NOW).known;
    expect(detectHighImpact(known, [item("e", 99, true, FRESH_WINDOW_MS + 1)], 80, NOW).fresh).toEqual([]);
  });
});

describe("isTypingTarget", () => {
  const plain = { metaKey: false, ctrlKey: false, altKey: false };
  it("skips fields and modified keys", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget, plain)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget, plain)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV" } as unknown as EventTarget, { ...plain, ctrlKey: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget, plain)).toBe(false);
  });
});
