import { describe, expect, it } from "vitest";
import { BETA_POINTS_SINCE, betaWindows, dayInBeta, inBeta, readBetaLog } from "./beta-points";

const HOUR = 3_600_000;
const since = BETA_POINTS_SINCE;

describe("closed beta points windows", () => {
  it("runs from the start while the switch was never flipped", () => {
    const windows = betaWindows([]);
    expect(windows).toEqual([[since, Infinity]]);
    expect(inBeta(windows, since - 1)).toBe(false);
    expect(inBeta(windows, since + 10 * HOUR)).toBe(true);
  });

  it("ends when the beta opens and starts again when it closes", () => {
    const windows = betaWindows(readBetaLog([`${since + 5 * HOUR}:0`, `${since + 9 * HOUR}:1`, `${since + 12 * HOUR}:0`, "junk"]));
    expect(windows).toEqual([
      [since, since + 5 * HOUR],
      [since + 9 * HOUR, since + 12 * HOUR],
    ]);
    expect(inBeta(windows, since + 5 * HOUR - 1)).toBe(true);
    expect(inBeta(windows, since + 5 * HOUR)).toBe(false);
    expect(inBeta(windows, since + 10 * HOUR)).toBe(true);
    expect(inBeta(windows, since + 20 * HOUR)).toBe(false);
  });

  it("takes the state at the start from flips before it", () => {
    expect(betaWindows([{ at: since - HOUR, closed: false }])).toEqual([]);
    expect(betaWindows([{ at: since - HOUR, closed: false }, { at: since + HOUR, closed: true }])).toEqual([[since + HOUR, Infinity]]);
  });

  it("counts an Orderly day that overlaps the beta", () => {
    const windows = betaWindows([{ at: Date.parse("2026-10-12T03:00:00Z"), closed: false }]);
    expect(dayInBeta(windows, Date.parse("2026-10-09T00:00:00Z"))).toBe(true);
    expect(dayInBeta(windows, Date.parse("2026-10-12T00:00:00Z"))).toBe(true);
    expect(dayInBeta(windows, Date.parse("2026-10-13T00:00:00Z"))).toBe(false);
    expect(dayInBeta(windows, Date.parse("2026-10-08T00:00:00Z"))).toBe(false);
  });
});
