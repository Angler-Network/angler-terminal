import { describe, expect, it, vi } from "vitest";
import type { ExtendedBuilderTrade } from "./extended-volume";

vi.mock("server-only", () => ({}));

const { extendedAnglerVolume, readBuilderPage } = await import("./extended-volume");

const BUILDER = 300382;

// Shaped like the docs' example: each row carries only the side our builder code was on.
const rows: ExtendedBuilderTrade[] = [
  { time: 3000, volume: "1200", takerId: 4088, takerBuilderId: BUILDER, takerBuilderFee: "0.42", makerId: null, makerBuilderId: null, makerBuilderFee: null },
  { time: 2000, volume: "5296.806", makerId: 3017, makerBuilderId: BUILDER, makerBuilderFee: "1.8538821", takerId: null, takerBuilderId: null, takerBuilderFee: null },
  { time: 1000, volume: "900", takerId: 3017, takerBuilderId: BUILDER, takerBuilderFee: "0.315", makerId: null, makerBuilderId: null, makerBuilderFee: null },
  // Another builder's code: never ours, even on a linked account.
  { time: 2500, volume: "777", takerId: 3017, takerBuilderId: 5021, takerBuilderFee: "0.1", makerId: null, makerBuilderId: null, makerBuilderFee: null },
];

describe("extendedAnglerVolume", () => {
  it("counts the linked accounts' trades after the cursor, on either side", () => {
    const volume = extendedAnglerVolume(rows, [3017], BUILDER, 0);
    expect(volume.usd).toBeCloseTo(6196.806, 6);
    expect(volume.fee).toBeCloseTo(2.1688821, 6);
    expect(volume.lastTime).toBe(2000);
  });

  it("skips what an earlier sync counted and other accounts", () => {
    expect(extendedAnglerVolume(rows, [3017], BUILDER, 2000).usd).toBe(0);
    expect(extendedAnglerVolume(rows, [3017], BUILDER, 1000).usd).toBeCloseTo(5296.806, 6);
    expect(extendedAnglerVolume(rows, [9999], BUILDER, 0)).toEqual({ usd: 0, betaUsd: 0, fee: 0, lastTime: 0 });
  });

  it("splits out closed beta volume", () => {
    expect(extendedAnglerVolume(rows, [3017, 4088], BUILDER, 0, (time) => time >= 2000).betaUsd).toBeCloseTo(6496.806, 6);
  });
});

describe("readBuilderPage", () => {
  it("keeps the cursor's digits past 2^53", () => {
    const text = '{"status":"OK","data":[{"id":1784963886257016832,"time":1,"volume":"1"}],"pagination":{"cursor":1784963886257016831,"count":1}}';
    const page = readBuilderPage(text);
    expect(page.cursor).toBe("1784963886257016831");
    expect(page.rows).toHaveLength(1);
  });

  it("refuses an error answer", () => {
    expect(() => readBuilderPage('{"status":"ERROR","error":{"code":401}}')).toThrow();
  });
});
