import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { orderlyAnglerVolume } = await import("./orderly-volume");

const user = "0x5cc105bbd9f6382a4560ee01f0778092a2e5cf8f";
// Shaped like Orderly's live /v1/broker/leaderboard/daily rows.
const rows = [
  { date: "2026-10-05", perp_volume: 1000.5, broker_fee: 0.2, address: user, broker_id: "angler" },
  { date: "2026-10-06", perp_volume: "2500", broker_fee: "0.5", address: user.toUpperCase().replace("0X", "0x"), broker_id: "angler" },
  // Today (still open), another broker and another wallet never count.
  { date: "2026-10-08", perp_volume: 9999, broker_fee: 9, address: user, broker_id: "angler" },
  { date: "2026-10-06", perp_volume: 7777, broker_fee: 7, address: user, broker_id: "orderly" },
  { date: "2026-10-06", perp_volume: 5555, broker_fee: 5, address: "0x0000000000000000000000000000000000000001", broker_id: "angler" },
];
const now = Date.parse("2026-10-08T15:00:00Z");

describe("Orderly volume", () => {
  it("counts closed days of this wallet under our broker", () => {
    expect(orderlyAnglerVolume(rows, user, "angler", null, now)).toEqual({ usd: 3500.5, fee: 0.7, lastDay: Date.parse("2026-10-06") });
  });

  it("skips days at or before the cursor", () => {
    expect(orderlyAnglerVolume(rows, user, "angler", Date.parse("2026-10-05"), now)).toEqual({ usd: 2500, fee: 0.5, lastDay: Date.parse("2026-10-06") });
    expect(orderlyAnglerVolume(rows, user, "angler", Date.parse("2026-10-07"), now).usd).toBe(0);
  });
});
