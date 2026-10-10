"use client";

import { VenueError } from "../types";
import { agentExchange } from "./clients";
import { toVenueError } from "./errors";
import { requireTradingSetup } from "./venue";

/**
 * Deposit into or withdraw from a Hyperliquid vault (`vaultTransfer`, an L1 action the trading key signs, so no wallet
 * popup). `usd` is in micro-dollars; deposits come from and withdrawals go back to the perp margin.
 */
export async function hlVaultTransfer(user: `0x${string}`, vaultAddress: string, usd: number, isDeposit: boolean) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultAddress)) throw new VenueError("Unknown vault.");
  if (!(usd >= 1)) throw new VenueError("Enter an amount.");
  const { agent } = requireTradingSetup(user);
  try {
    const exchange = await agentExchange(agent.privateKey);
    await exchange.vaultTransfer({ vaultAddress: vaultAddress as `0x${string}`, isDeposit, usd });
  } catch (error) {
    throw toVenueError(error);
  }
}
