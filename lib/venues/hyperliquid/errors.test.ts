import { describe, expect, it } from "vitest";
import { VenueError } from "../types";
import { humanizeHlError, toVenueError } from "./errors";

describe("humanizeHlError", () => {
  it.each([
    ["Insufficient margin to place order. asset=0", /Not enough margin/],
    ["Order must have minimum value of $10. asset=0", /minimum order value is \$10/],
    ["Order price cannot be more than 80% away from the reference price", /too far from the market price/],
    ["Order could not immediately match against any resting orders. asset=0", /No liquidity/],
    ["Reduce only order would increase position. asset=0", /Reduce-only/],
    ["Builder fee has not been approved.", /Builder fee isn't approved/],
    ["User or API Wallet 0xabc does not exist.", /trading key was revoked/],
  ])("rewrites %s", (raw, expected) => {
    expect(humanizeHlError(raw)).toMatch(expected);
  });

  it("strips the SDK's bulk status prefix", () => {
    expect(humanizeHlError("order 0: Insufficient margin to place order.")).toMatch(/Not enough margin/);
  });

  it("passes unknown messages through", () => {
    expect(humanizeHlError("Something new")).toBe("Something new");
  });
});

describe("toVenueError", () => {
  it("reads top-level error responses and keeps the raw text", () => {
    const error = toVenueError({ message: "x", response: { status: "err", response: "Insufficient margin to place order." } });
    expect(error).toBeInstanceOf(VenueError);
    expect(error.message).toMatch(/Not enough margin/);
    expect(error.raw).toBe("Insufficient margin to place order.");
  });

  it("reads wallet rejections", () => {
    expect(toVenueError({ shortMessage: "User rejected the request." }).message).toBe("Request rejected in the wallet.");
  });
});
