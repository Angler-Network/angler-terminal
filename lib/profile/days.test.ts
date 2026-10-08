import { describe, expect, it } from "vitest";
import { dayKey, volumeOverDays } from "./days";

describe("volumeOverDays", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const buckets = { "2026-10-08": "100", "2026-10-02": "50.5", "2026-09-20": "1000", "2026-08-01": "5", junk: "x" };

  it("sums the last N UTC days, today included", () => {
    expect(dayKey(now)).toBe("2026-10-08");
    expect(volumeOverDays(buckets, 7, now)).toBe(150.5);
    expect(volumeOverDays(buckets, 30, now)).toBe(1150.5);
    expect(volumeOverDays({}, 7, now)).toBe(0);
  });
});
