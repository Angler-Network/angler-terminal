"use client";

import { VenueError } from "../types";
import { extendedApi } from "./api";
import { extendedConfig } from "./config";
import { extendedSession } from "./store";

/**
 * Extended testnet's "Claim" button: $1,000 of test USDC per wallet per hour (`POST /api/v1/user/claim`, found behind the
 * testnet app; the first claim of a new account has come back REJECTED with SYSTEM_ERROR, a second one went through).
 */
export async function claimExtendedTestFunds(user: string) {
  if (extendedConfig.network !== "testnet") throw new VenueError("Test funds exist on Extended testnet only.");
  const session = extendedSession(user);
  if (!session) throw new VenueError("Set up Extended trading first.");
  await extendedApi("/api/v1/user/claim", { method: "POST", apiKey: (await session).apiKey, body: {} });
}
