import { describe, expect, it } from "vitest";
import { readAcrossServerConfig } from "./across-server";

describe("readAcrossServerConfig", () => {
  it("keeps only well-formed settings and caps the fee at 1%", () => {
    expect(readAcrossServerConfig({})).toEqual({ integratorId: undefined, appFee: undefined, appFeeRecipient: undefined });
    expect(
      readAcrossServerConfig({ ACROSS_INTEGRATOR_ID: "0x00ab", ACROSS_APP_FEE: "0.001", ACROSS_APP_FEE_RECIPIENT: "0x1111111111111111111111111111111111111111" }),
    ).toEqual({ integratorId: "0x00ab", appFee: 0.001, appFeeRecipient: "0x1111111111111111111111111111111111111111" });
    expect(readAcrossServerConfig({ ACROSS_INTEGRATOR_ID: "abc", ACROSS_APP_FEE: "0.5" })).toMatchObject({ integratorId: undefined, appFee: undefined });
  });
});
