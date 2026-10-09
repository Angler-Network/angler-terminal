/**
 * Closed beta rules (pure; the switch itself lives in `lib/ops/beta.ts`). While the beta is closed:
 * - only admins' invite codes let someone in, and only admins get new codes (volume earns none until it opens);
 * - everyone else needs an admin's invite, unless they traded through Angler before.
 * Opened, the gate is gone and invites work as referrals again: earned by volume, any owner's code accepted.
 * The testnet site never has a gate.
 */

/** The stored switch: "1" closed, "0" open, anything else the deployment's default. */
export function readBetaFlag(value: unknown, fallback: boolean) {
  return value === "1" ? true : value === "0" ? false : fallback;
}

export function hasAccess(input: { testnet: boolean; closedBeta: boolean; admin: boolean; referred: boolean; traded: boolean }) {
  return input.testnet || !input.closedBeta || input.admin || input.referred || input.traded;
}

/** Whether a profile gets invite codes for its volume now. */
export function mintsInvites(input: { closedBeta: boolean; admin: boolean }) {
  return input.admin || !input.closedBeta;
}

/** Whether a code may be used to join now: during the closed beta only an admin's. */
export function inviteUsable(input: { closedBeta: boolean; ownerIsAdmin: boolean }) {
  return !input.closedBeta || input.ownerIsAdmin;
}
