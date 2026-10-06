/**
 * Which site this build is: the mainnet terminal (trade.angler.network) or the testnet one
 * (testnet-trade.angler.network), from one codebase. `NEXT_PUBLIC_DEPLOYMENT` pins every venue's network, hides the
 * per-browser network switches and, on testnet, turns off the mainnet-only Solana venues (Jupiter, Titan). Unset,
 * each venue follows its own NEXT_PUBLIC_*_NETWORK and the switches stay in Settings.
 */

export type Deployment = "mainnet" | "testnet";

export function readDeployment(value: string | undefined): Deployment | null {
  return value === "mainnet" || value === "testnet" ? value : null;
}

// Next.js inlines NEXT_PUBLIC_* only when accessed by their full name.
export const deployment = readDeployment(process.env.NEXT_PUBLIC_DEPLOYMENT);

/** The other site, linked from the top bar and Settings (e.g. https://testnet-trade.angler.network). */
export const otherDeploymentUrl = readUrl(process.env.NEXT_PUBLIC_OTHER_DEPLOYMENT_URL);

/** Venue network for this build: the deployment's when pinned, else the browser override, else the venue's env. */
export function pinnedNetwork<N extends string>(pinned: Deployment | null, override: N | undefined, fromEnv: string | undefined) {
  return pinned ?? override ?? fromEnv;
}

/** Jupiter and Titan have no testnet: they only run on mainnet builds (and unpinned ones). */
export function mainnetSpotAllowed(pinned: Deployment | null) {
  return pinned !== "testnet";
}

function readUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}
