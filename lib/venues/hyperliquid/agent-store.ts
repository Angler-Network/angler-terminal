import type { HlNetwork } from "./config";

/**
 * The agent (API wallet) key lives only in this browser's localStorage, scoped per network and user address.
 * It is never logged, never sent to our server, and only ever used to sign L1 actions locally. Hyperliquid agent
 * keys can place and cancel orders but cannot withdraw or transfer funds.
 */
export interface StoredAgent {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  name: string;
  createdAt: number;
}

export interface OnboardingRecord {
  builderApproved?: { builder: string; maxFee: number };
  agent?: StoredAgent;
}

const PREFIX = "angler:hl";

export function storageKey(network: HlNetwork, user: string) {
  return `${PREFIX}:${network}:${user.toLowerCase()}`;
}

function isAgent(value: unknown): value is StoredAgent {
  const agent = value as StoredAgent | null;
  return (
    !!agent &&
    /^0x[a-fA-F0-9]{40}$/.test(agent.address) &&
    /^0x[a-fA-F0-9]{64}$/.test(agent.privateKey) &&
    typeof agent.name === "string"
  );
}

export function readOnboarding(storage: Pick<Storage, "getItem">, network: HlNetwork, user: string): OnboardingRecord {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(network, user)) ?? "{}") as OnboardingRecord;
    return {
      builderApproved:
        parsed.builderApproved && typeof parsed.builderApproved.builder === "string" ? parsed.builderApproved : undefined,
      agent: isAgent(parsed.agent) ? parsed.agent : undefined,
    };
  } catch {
    return {};
  }
}

export function writeOnboarding(
  storage: Pick<Storage, "setItem" | "removeItem">,
  network: HlNetwork,
  user: string,
  record: OnboardingRecord,
) {
  const key = storageKey(network, user);
  if (!record.agent && !record.builderApproved) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(record));
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
