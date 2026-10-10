import { describe, expect, it } from "vitest";
import { isFourMemeAddress } from "./four-meme";

describe("isFourMemeAddress", () => {
  it("knows Four.meme's vanity addresses on BNB Chain only", () => {
    expect(isFourMemeAddress(56, "0x8d7373093f44b486caa9be4cae1abd148b034444")).toBe(true);
    expect(isFourMemeAddress(56, "0x40B164BBD43A467CC7D8F227D9F95A629414FFFF")).toBe(true);
    expect(isFourMemeAddress(56, "0x55d398326f99059fF775485246999027B3197955")).toBe(false);
    expect(isFourMemeAddress(8453, "0x8d7373093f44b486caa9be4cae1abd148b034444")).toBe(false);
    expect(isFourMemeAddress(56, null)).toBe(false);
  });
});
