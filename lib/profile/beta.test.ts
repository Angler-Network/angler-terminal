import { describe, expect, it } from "vitest";
import { hasAccess, inviteUsable, mintsInvites, readBetaFlag } from "./beta";

const nobody = { testnet: false, closedBeta: true, admin: false, referred: false, traded: false };

describe("closed beta", () => {
  it("reads the stored switch, else the deployment's default", () => {
    expect(readBetaFlag("1", false)).toBe(true);
    expect(readBetaFlag("0", true)).toBe(false);
    expect(readBetaFlag(null, true)).toBe(true);
    expect(readBetaFlag("yes", false)).toBe(false);
  });

  it("lets in admins, invited and past traders while closed, everyone once open, everyone on testnet", () => {
    expect(hasAccess(nobody)).toBe(false);
    expect(hasAccess({ ...nobody, admin: true })).toBe(true);
    expect(hasAccess({ ...nobody, referred: true })).toBe(true);
    expect(hasAccess({ ...nobody, traded: true })).toBe(true);
    expect(hasAccess({ ...nobody, closedBeta: false })).toBe(true);
    expect(hasAccess({ ...nobody, testnet: true })).toBe(true);
  });

  it("gives only admins invite codes while closed", () => {
    expect(mintsInvites({ closedBeta: true, admin: false })).toBe(false);
    expect(mintsInvites({ closedBeta: true, admin: true })).toBe(true);
    expect(mintsInvites({ closedBeta: false, admin: false })).toBe(true);
  });

  it("accepts only admins' codes while closed, any code once open", () => {
    expect(inviteUsable({ closedBeta: true, ownerIsAdmin: false })).toBe(false);
    expect(inviteUsable({ closedBeta: true, ownerIsAdmin: true })).toBe(true);
    expect(inviteUsable({ closedBeta: false, ownerIsAdmin: false })).toBe(true);
  });
});
