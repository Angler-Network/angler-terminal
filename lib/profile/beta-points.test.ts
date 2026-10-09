import { describe, expect, it } from "vitest";
import { BETA_POINTS_SINCE, betaWindow, dayInBeta, inBeta } from "./beta-points";

const HOUR = 3_600_000;
const since = BETA_POINTS_SINCE;

describe("closed beta points event", () => {
  it("runs from the start while the beta is still closed", () => {
    const window = betaWindow(null);
    expect(window).toEqual({ start: since, end: Infinity });
    expect(inBeta(window, since - 1)).toBe(false);
    expect(inBeta(window, since + 10 * HOUR)).toBe(true);
  });

  it("ends when the beta opens", () => {
    const window = betaWindow(String(since + 5 * HOUR));
    expect(inBeta(window, since + 5 * HOUR - 1)).toBe(true);
    expect(inBeta(window, since + 5 * HOUR)).toBe(false);
    // Opened before the event started: no event.
    expect(betaWindow(String(since - HOUR))).toBeNull();
    expect(inBeta(null, since)).toBe(false);
  });

  it("counts an Orderly day that overlaps the event", () => {
    const window = betaWindow(String(Date.parse("2026-10-30T03:00:00Z")));
    expect(dayInBeta(window, Date.parse("2026-10-09T00:00:00Z"))).toBe(true);
    expect(dayInBeta(window, Date.parse("2026-10-30T00:00:00Z"))).toBe(true);
    expect(dayInBeta(window, Date.parse("2026-10-31T00:00:00Z"))).toBe(false);
    expect(dayInBeta(window, Date.parse("2026-10-08T00:00:00Z"))).toBe(false);
  });
});
