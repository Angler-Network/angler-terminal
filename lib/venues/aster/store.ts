"use client";

import { asterConfig } from "./config";

/** What this browser knows about a wallet's Aster setup (localStorage), without the signing code. */

export interface AsterAgent {
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

export interface AsterRecord {
  agent?: AsterAgent;
  /** The builder and cap this wallet approved. */
  builder?: { address: string; maxFeeRate: number };
}

export interface AsterOnboarding {
  agentReady: boolean;
  builder: "none" | "needed" | "approved";
}

const KEY = "angler:aster:mainnet";
const storageKey = (user: string) => `${KEY}:${user.toLowerCase()}`;

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readAsterRecord(user: string): AsterRecord {
  try {
    const parsed = JSON.parse(storage()?.getItem(storageKey(user)) ?? "{}") as AsterRecord;
    const agent = parsed.agent && /^0x[0-9a-fA-F]{40}$/.test(parsed.agent.address) && /^0x[0-9a-fA-F]{64}$/.test(parsed.agent.privateKey) ? parsed.agent : undefined;
    return { agent, builder: parsed.builder && typeof parsed.builder.address === "string" ? parsed.builder : undefined };
  } catch {
    return {};
  }
}

export function writeAsterRecord(user: string, record: AsterRecord) {
  const store = storage();
  if (!store) return;
  if (!record.agent && !record.builder) store.removeItem(storageKey(user));
  else store.setItem(storageKey(user), JSON.stringify(record));
}

export function asterOnboarding(user: string): AsterOnboarding {
  const record = readAsterRecord(user);
  const builder = asterConfig.builder;
  const builderState = !builder
    ? "none"
    : record.builder?.address.toLowerCase() === builder.address.toLowerCase() && record.builder.maxFeeRate >= builder.feeRate
      ? "approved"
      : "needed";
  return { agentReady: Boolean(record.agent), builder: builderState };
}

/** Forgets the key here (it can't withdraw; Aster lets it expire or be removed from the Aster app). */
export function forgetAsterAgent(user: string) {
  const record = readAsterRecord(user);
  writeAsterRecord(user, { ...record, agent: undefined });
}
