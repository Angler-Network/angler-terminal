import { describe, expect, it } from "vitest";
import { VenueError } from "../types";
import { LighterApiError, humanizeLighterError, humanizeLighterStatus, toLighterVenueError } from "./errors";

describe("Lighter errors", () => {
  it("maps API codes to readable messages", () => {
    expect(humanizeLighterError(21100, "account not found")).toMatch(/no Lighter account yet/);
    expect(humanizeLighterError(21739, "not enough margin to create the order")).toMatch(/Not enough margin/);
    expect(humanizeLighterError(21108, "invalid PublicKey,please run changePubKey")).toMatch(/Set up trading again/);
    expect(humanizeLighterError(23000, "Too Many Requests!")).toMatch(/rate limiting/);
    // Seen live on testnet when the ChangePubKey L1 signature doesn't match the account owner.
    expect(humanizeLighterError(21504, "fail to l1 signature")).toMatch(/wallet signature/);
  });

  it("keeps unknown messages, trimmed", () => {
    expect(humanizeLighterError(99999, "something new")).toBe("something new");
    expect(humanizeLighterError(undefined, "x".repeat(300))).toHaveLength(201);
    expect(humanizeLighterError(undefined, "User rejected the request.")).toBe("Request rejected in the wallet.");
  });

  it("explains canceled orders", () => {
    expect(humanizeLighterStatus("canceled-too-much-slippage")).toMatch(/price limit/);
    expect(humanizeLighterStatus("canceled-margin-not-allowed")).toMatch(/margin/);
    expect(humanizeLighterStatus("canceled-something-new")).toMatch(/canceled/);
  });

  it("wraps API errors as VenueErrors with the raw answer", () => {
    const error = new LighterApiError(21104, "invalid nonce");
    expect(error).toBeInstanceOf(VenueError);
    expect(error.code).toBe(21104);
    expect(error.raw).toBe("21104: invalid nonce");
    expect(toLighterVenueError(error)).toBe(error);
    expect(toLighterVenueError(new Error("Failed to fetch")).message).toMatch(/Can't reach Lighter/);
  });
});
