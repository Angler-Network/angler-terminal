import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import sample from "./fixtures/quote-sample.json";
import { readTitanRoute } from "./route";
import { compileTitanTransaction } from "./server";

const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

// Bytes produced by the previous @solana/web3.js implementation (VersionedTransaction + compileToV0Message): the
// @solana/kit version must build exactly the same unsigned transactions.
const expected = {
  fixture:
    "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAIAAgR+jAiHYL/eHd3PMsF/IJuCQu5SqvEx+s2I0OosbQsG8mp5WVdBeEzSke2kFEN1rW6wBdnYkGQVSL4RlbHXa0UAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAGqZxuEucOuzUYXBRMS5BuGP+wCkd0LypeBBELaYjJ1MSa53YDeCBU8Xqd7OpDtETroO2xLG8dMcbg5KhL8FLrAgIABQLAXBUAAwEBAwQFBgA=",
  noLookupTables:
    "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAIAAgR+jAiHYL/eHd3PMsF/IJuCQu5SqvEx+s2I0OosbQsG8mp5WVdBeEzSke2kFEN1rW6wBdnYkGQVSL4RlbHXa0UAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAGqZxuEucOuzUYXBRMS5BuGP+wCkd0LypeBBELaYjJ1MSa53YDeCBU8Xqd7OpDtETroO2xLG8dMcbg5KhL8FLrAgIABQLAXBUAAwEBAwQFBgA=",
  hasComputeBudget:
    "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAIAAgR+jAiHYL/eHd3PMsF/IJuCQu5SqvEx+s2I0OosbQsG8mp5WVdBeEzSke2kFEN1rW6wBdnYkGQVSL4RlbHXa0UAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAGqZxuEucOuzUYXBRMS5BuGP+wCkd0LypeBBELaYjJ1MSa53YDeCBU8Xqd7OpDtETroO2xLG8dMcbg5KhL8FLrAgIABQLAXBUAAwEBAwQFBgA=",
  noComputeUnits:
    "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAIAAQN+jAiHYL/eHd3PMsF/IJuCQu5SqvEx+s2I0OosbQsG8mp5WVdBeEzSke2kFEN1rW6wBdnYkGQVSL4RlbHXa0UABqmcbhLnDrs1GFwUTEuQbhj/sApHdC8qXgQRC2mIydTEmud2A3ggVPF6nezqQ7RE66DtsSxvHTHG4OSoS/BS6wECAQEDBAUGAA==",
};

describe("compileTitanTransaction", () => {
  const route = readTitanRoute(sample)!;
  const cases = {
    fixture: route,
    noLookupTables: { ...route, lookupTables: [] },
    hasComputeBudget: { ...route, instructions: [{ p: "ComputeBudget111111111111111111111111111111", a: [], d: "AsBcFQA=" }, ...route.instructions] },
    noComputeUnits: { ...route, computeUnitsSafe: 0 },
  };

  for (const [name, input] of Object.entries(cases)) {
    it(`matches the web3.js bytes: ${name}`, () => {
      expect(compileTitanTransaction(input, TAKER, BLOCKHASH)).toBe(expected[name as keyof typeof expected]);
    });
  }
});
