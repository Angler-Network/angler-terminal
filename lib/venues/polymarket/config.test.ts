import { describe, expect, it } from "vitest";
import { isSignableBuilderRequest, readBuilderCode } from "./config";

describe("Polymarket config", () => {
  it("accepts only a non-zero bytes32 builder code", () => {
    const code = `0x${"ab".repeat(32)}`;
    expect(readBuilderCode(` ${code} `)).toBe(code);
    expect(readBuilderCode(`0x${"0".repeat(64)}`)).toBeNull();
    expect(readBuilderCode("0x1234")).toBeNull();
    expect(readBuilderCode(undefined)).toBeNull();
  });

  it("signs only order, cancel and relayer style requests", () => {
    expect(isSignableBuilderRequest("POST", "/order")).toBe(true);
    expect(isSignableBuilderRequest("DELETE", "/orders")).toBe(true);
    expect(isSignableBuilderRequest("POST", "/submit")).toBe(true);
    expect(isSignableBuilderRequest("GET", "/order")).toBe(false);
    expect(isSignableBuilderRequest("POST", "https://evil.example/x")).toBe(false);
    expect(isSignableBuilderRequest("POST", "/../admin")).toBe(false);
    expect(isSignableBuilderRequest("POST", 42)).toBe(false);
  });
});
