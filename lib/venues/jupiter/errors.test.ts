import { describe, expect, it } from "vitest";
import { executeErrorMessage, MESSAGES, orderErrorMessage, walletErrorMessage } from "./errors";

describe("orderErrorMessage", () => {
  it("reads codes per router", () => {
    expect(orderErrorMessage("metis", 1)).toBe(MESSAGES.insufficientBalance);
    expect(orderErrorMessage("okx", 2)).toBe(MESSAGES.insufficientSol);
    expect(orderErrorMessage("jupiterz", 2)).toMatch(/token account/);
  });

  it("falls back to Jupiter's message", () => {
    expect(orderErrorMessage("metis", 99, "Something else")).toBe("Something else");
  });
});

describe("executeErrorMessage", () => {
  it("detects slippage from program errors", () => {
    expect(executeErrorMessage(-1000, "custom program error: 0x1771")).toBe(MESSAGES.priceMoved);
    expect(executeErrorMessage(-1001, "SlippageToleranceExceeded")).toBe(MESSAGES.priceMoved);
  });

  it("separates insufficient SOL from insufficient token balance", () => {
    expect(executeErrorMessage(-1000, "Transfer: insufficient lamports 100, need 5000")).toBe(MESSAGES.insufficientSol);
    expect(executeErrorMessage(-1000, "custom program error: 0x1788")).toBe(MESSAGES.insufficientBalance);
  });

  it("maps codes when there is no program error", () => {
    expect(executeErrorMessage(-1)).toBe(MESSAGES.expired);
    expect(executeErrorMessage(-2003)).toBe(MESSAGES.expired);
    expect(executeErrorMessage(-2004)).toMatch(/price moved/);
    expect(executeErrorMessage(-1000)).toBe(MESSAGES.landing);
  });
});

describe("walletErrorMessage", () => {
  it("recognises rejections", () => {
    expect(walletErrorMessage({ code: 4001, message: "x" })).toBe(MESSAGES.rejected);
    expect(walletErrorMessage(new Error("User rejected the request."))).toBe(MESSAGES.rejected);
  });
});
