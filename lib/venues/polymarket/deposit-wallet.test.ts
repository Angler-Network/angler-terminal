import { describe, expect, it } from "vitest";
import { depositWalletCandidates } from "./deposit-wallet";

// The SDK's own derivations (`Ss` beacon, `Es` implementation), exported from its bundle under these names in 0.12.0.
// @ts-expect-error: an internal bundle file, without type declarations.
const sdk = (await import("../../../node_modules/@polymarket/client/dist/chunk-5JHFOBBZ.js")) as Record<string, (signer: string, config: Record<string, string>) => string>;
const CONFIG = {
  depositWalletFactory: "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07",
  depositWalletBeacon: "0x7A18EDfe055488A3128f01F563e5B479D92ffc3a",
  depositWalletImplementation: "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB",
};

describe("depositWalletCandidates", () => {
  it("matches @polymarket/client for the beacon and implementation proxies", () => {
    for (const signer of ["0x92c78D8f12a214184DB7aCBCCc6e34d8A197C136", "0x0000000000000000000000000000000000000001", "0xffffffffffffffffffffffffffffffffffffffff"] as const) {
      const [beacon, implementation] = depositWalletCandidates(signer);
      expect(beacon).toBe(sdk.O(signer, CONFIG).toLowerCase());
      expect(implementation).toBe(sdk.N(signer, CONFIG).toLowerCase());
    }
  });
});
