import { describe, expect, it } from "vitest";
import { readTwapJobs } from "./twap-store";

const job = {
  id: "a",
  venue: "hyperliquid",
  symbol: "BTC",
  side: "buy",
  totalSize: 1,
  szDecimals: 4,
  slices: 4,
  intervalMs: 60_000,
  randomize: false,
  reduceOnly: false,
  leverage: 3,
  isCross: true,
  createdAt: 0,
  nextAt: 0,
  done: 0,
  filledSize: 0,
  filledNotional: 0,
  failures: 0,
  status: "running",
};

describe("readTwapJobs", () => {
  it("keeps valid jobs and drops broken ones", () => {
    const raw = JSON.stringify([job, { ...job, id: "b", side: "up" }, { ...job, id: "c", done: "1" }, null]);
    expect(readTwapJobs(raw).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("drops finished jobs after a day but keeps active ones", () => {
    const day = 86_400_000;
    const raw = JSON.stringify([{ ...job, id: "old", status: "done" }, { ...job, id: "paused", status: "paused" }, { ...job, id: "new", status: "done", nextAt: day }]);
    expect(readTwapJobs(raw, day + 1).map((entry) => entry.id)).toEqual(["paused", "new"]);
  });

  it("reads nothing from garbage", () => {
    expect(readTwapJobs(null)).toEqual([]);
    expect(readTwapJobs("{")).toEqual([]);
    expect(readTwapJobs("{}")).toEqual([]);
  });
});
