"use client";

import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { VenueError } from "../types";
import { browserStorage, readOnboarding, writeOnboarding, type OnboardingRecord } from "./agent-store";
import { infoClient, userExchange } from "./clients";
import { AGENT_NAME, feeToPercent, hlConfig } from "./config";
import { toVenueError } from "./errors";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface OnboardingStatus {
  builderApproved: boolean;
  agentAddress: `0x${string}` | null;
}

function storage() {
  const value = browserStorage();
  if (!value) throw new VenueError("Browser storage is unavailable, so a trading key can't be kept.");
  return value;
}

function update(user: string, change: (record: OnboardingRecord) => OnboardingRecord) {
  const store = storage();
  writeOnboarding(store, hlConfig.network, user, change(readOnboarding(store, hlConfig.network, user)));
}

/**
 * What's left to do for this user. Local state is a cache: the builder approval and the agent are re-checked
 * against the Info API so an agent revoked elsewhere (or expired) is dropped here too.
 */
export async function getOnboardingStatus(user: `0x${string}`): Promise<OnboardingStatus> {
  const store = browserStorage();
  const record = store ? readOnboarding(store, hlConfig.network, user) : {};
  const builder = hlConfig.builder;
  const info = await infoClient();

  const [approvedFee, agents] = await Promise.all([
    builder ? info.maxBuilderFee({ user, builder: builder.address }).catch(() => null) : Promise.resolve(null),
    record.agent ? info.extraAgents({ user }).catch(() => null) : Promise.resolve(null),
  ]);

  const builderApproved = !builder || (approvedFee !== null ? approvedFee >= builder.fee : record.builderApproved?.builder === builder.address);
  let agent = record.agent ?? null;
  if (agent && agents && !agents.some((entry) => entry.address.toLowerCase() === agent!.address.toLowerCase())) {
    agent = null;
    if (store) update(user, ({ agent: _dropped, ...rest }) => rest);
  }
  if (builder && approvedFee !== null && store) {
    update(user, (current) => ({
      ...current,
      builderApproved: approvedFee >= builder.fee ? { builder: builder.address, maxFee: approvedFee } : undefined,
    }));
  }
  return { builderApproved, agentAddress: agent?.address ?? null };
}

/** Step 1: the user's wallet approves our builder for up to the configured max fee. */
export async function approveBuilderFee(wallet: AbstractWallet, user: `0x${string}`) {
  const builder = hlConfig.builder;
  if (!builder) throw new VenueError("NEXT_PUBLIC_HL_BUILDER_ADDRESS is not configured.");
  try {
    await (await userExchange(wallet)).approveBuilderFee({ builder: builder.address, maxFeeRate: feeToPercent(builder.maxFee) });
  } catch (error) {
    throw toVenueError(error);
  }
  update(user, (record) => ({ ...record, builderApproved: { builder: builder.address, maxFee: builder.maxFee } }));
}

/**
 * Step 2: a fresh agent key is generated in the browser and approved by the user's wallet. Agents can trade but
 * cannot withdraw. Reusing the agent name replaces any previous Angler agent on this account.
 */
export async function approveAgent(wallet: AbstractWallet, user: `0x${string}`) {
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const privateKey = generatePrivateKey();
  const agentAddress = privateKeyToAccount(privateKey).address;
  try {
    await (await userExchange(wallet)).approveAgent({ agentAddress, agentName: AGENT_NAME });
  } catch (error) {
    throw toVenueError(error);
  }
  update(user, (record) => ({ ...record, agent: { address: agentAddress, privateKey, name: AGENT_NAME, createdAt: Date.now() } }));
  return agentAddress;
}

/** Revoking approves the zero address under the same agent name, then forgets the key locally. */
export async function revokeAgent(wallet: AbstractWallet, user: `0x${string}`) {
  try {
    await (await userExchange(wallet)).approveAgent({ agentAddress: ZERO_ADDRESS, agentName: AGENT_NAME });
  } catch (error) {
    throw toVenueError(error);
  }
  forgetAgent(user);
}

/** Drops the local key without an on-chain call (e.g. after revoking from Hyperliquid's own UI). */
export function forgetAgent(user: `0x${string}`) {
  update(user, ({ agent: _dropped, ...rest }) => rest);
}
