"use client";

import { VenueError } from "../types";
import type { LighterConfig } from "./config";
import { toLighterVenueError } from "./errors";
import { requireSession, signAndSend, waitForTx } from "./session";
import { signPoolShares } from "./signer";

/**
 * Lighter public pool deposits and withdrawals: mint shares with the account's perps USDC, burn them back. Signed with
 * the browser's trading key (no wallet popup). A burn must come from the account holding the shares, which is the
 * account the trading key belongs to.
 */
export async function lighterPoolTransfer(config: LighterConfig, user: string, poolIndex: number, kind: "mint" | "burn", shares: number, heldBy?: Record<string, number>) {
  if (!(shares >= 1)) throw new VenueError("Too small for one pool share.");
  try {
    const session = await requireSession(config, user);
    if (kind === "burn" && heldBy && !heldBy[session.accountIndex]) {
      throw new VenueError(`These shares sit in another ${config.name} account than the one this trading key signs for. Withdraw them on ${config.name}.`);
    }
    const hash = await signAndSend(session, (nonce) => signPoolShares(session.signer, kind, poolIndex, Math.floor(shares), nonce));
    await waitForTx(config, hash);
  } catch (error) {
    throw toLighterVenueError(error);
  }
}
