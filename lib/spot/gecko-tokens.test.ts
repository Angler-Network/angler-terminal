import { describe, expect, it } from "vitest";
import { readGeckoPoolBaseTokens, readGeckoPoolTokens } from "./gecko-tokens";
import { fromUniswapToken } from "./listings";

// Shaped like GeckoTerminal's `/networks/robinhood/dexes/pons-v2/pools?include=base_token,quote_token` reply.
const MUMM = "0xa348201512b586974f8807eaa1605adec5d87826";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const body = {
  data: [{ relationships: { base_token: { data: { id: `robinhood_${MUMM}` } }, quote_token: { data: { id: `robinhood_${WETH}` } } } }],
  included: [
    { id: `robinhood_${MUMM}`, type: "token", attributes: { address: MUMM, symbol: "MUMM", name: "Mumm", decimals: 18, image_url: "https://example.com/mumm.png" } },
    { id: `robinhood_${WETH}`, type: "token", attributes: { address: WETH, symbol: "WETH", name: "Wrapped Ether", decimals: 18, image_url: null } },
  ],
};

describe("GeckoTerminal pool tokens", () => {
  it("reads both sides of a pool, or only the launched (base) token", () => {
    expect(readGeckoPoolTokens(body, 4663).map((token) => token.symbol)).toEqual(["MUMM", "WETH"]);
    const bases = readGeckoPoolBaseTokens(body, 4663);
    expect(bases).toHaveLength(1);
    expect(bases[0]).toMatchObject({ address: MUMM, symbol: "MUMM", chainId: 4663, decimals: 18 });
    expect(readGeckoPoolBaseTokens({}, 4663)).toEqual([]);
  });

  it("keeps a Pons launch's stage on its listing", () => {
    const [mumm] = readGeckoPoolBaseTokens(body, 4663);
    expect(fromUniswapToken({ ...mumm, pons: "curve" })).toMatchObject({ symbol: "MUMM", pons: "curve", verified: false });
    expect(fromUniswapToken(mumm)?.pons).toBeUndefined();
  });
});
