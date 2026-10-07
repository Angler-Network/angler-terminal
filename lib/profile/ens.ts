import "server-only";
import { unstable_cache } from "next/cache";
import { createPublicClient, getAddress, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

export interface EnsIdentity {
  name: string;
  /** An https avatar URL from the name's ENS avatar record, when it has one. */
  avatar: string | null;
}

const client = createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC_URL?.trim() || undefined, { timeout: 8_000 }) });

/**
 * The wallet's primary ENS name (its reverse record, which only the owner can set) when that name also resolves back
 * to the wallet, plus its avatar. Throws on RPC errors so they aren't cached; "no name" is a cached null.
 */
async function lookup(address: string): Promise<EnsIdentity | null> {
  const checksummed = getAddress(address);
  const name = await client.getEnsName({ address: checksummed });
  if (!name) return null;
  const normalized = normalize(name);
  const forward = await client.getEnsAddress({ name: normalized });
  if (!forward || forward.toLowerCase() !== checksummed.toLowerCase()) return null;
  const avatar = await client.getEnsAvatar({ name: normalized }).catch(() => null);
  return { name, avatar: avatar && avatar.startsWith("https://") ? avatar : null };
}

const cached = unstable_cache(lookup, ["ens-identity-v1"], { revalidate: 6 * 3600 });

/** ENS for an EVM profile id (lowercase address); null for Solana ids, missing names and RPC failures. */
export async function ensOf(id: string): Promise<EnsIdentity | null> {
  if (!/^0x[0-9a-f]{40}$/.test(id)) return null;
  try {
    return await cached(id);
  } catch {
    return null;
  }
}
