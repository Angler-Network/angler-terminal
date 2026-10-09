import { describe, expect, it } from "vitest";
import { formatPrice } from "./format";

describe("formatPrice", () => {
  it("keeps cents above a dollar and significant digits below", () => {
    expect(formatPrice(1234.5)).toBe("$1,234.50");
    expect(formatPrice(0.01234)).toBe("$0.01234");
    expect(formatPrice(0)).toBe("$0.00");
  });

  it("counts the zeros of tiny prices in subscript", () => {
    expect(formatPrice(0.0000000000000246)).toBe("$0.0₁₃246");
    expect(formatPrice(0.00000121)).toBe("$0.0₅121");
    expect(formatPrice(0.00009999)).toBe("$0.0₄9999");
    expect(formatPrice(-0.00000005)).toBe("-$0.0₇5");
  });
});
