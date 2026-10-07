import { describe, expect, it } from "vitest";
import { routeStatus } from "./bridge-routes";

describe("routeStatus", () => {
  it("knows which directions work today", () => {
    expect(routeStatus("hyperliquid", "lighter")).toBe("ready");
    expect(routeStatus("lighter", "hyperliquid")).toBe("soon");
    expect(routeStatus("hyperliquid", "aster")).toBe("soon");
    expect(routeStatus("lighter", "lighter")).toBe("same");
  });
});
