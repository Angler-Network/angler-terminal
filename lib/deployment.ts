/**
 * Which site this build is: the mainnet terminal (trade.angler.network) or the testnet one
 * (testnet-trade.angler.network), from one codebase. `NEXT_PUBLIC_DEPLOYMENT` pins every venue's network, hides the
 * per-browser network switches and limits venues (`venueAvailable`): testnet drops the mainnet-only Solana venues,
 * mainnet offers only venues whose settings are present. Unset,
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

export type VenueKey = "hyperliquid" | "lighter" | "lighterRh" | "jupiter" | "titan" | "arcus" | "uniswap";

/** Venues whose required settings this build has (computed in next.config.mjs from env presence, names only). */
export const configuredVenues = readConfiguredVenues(process.env.NEXT_PUBLIC_CONFIGURED_VENUES);

export function readConfiguredVenues(value: string | undefined) {
  return new Set((value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
}

/**
 * Whether a venue can be used on this build. The mainnet site only offers venues whose settings are present (a
 * builder address for Hyperliquid, API keys for Jupiter, Titan, Arcus and Uniswap); the testnet site has no
 * mainnet-only venues (Jupiter, Titan, Uniswap); unpinned builds offer everything.
 */
export function venueAvailable(venue: VenueKey, pinned: Deployment | null = deployment, configured: Set<string> = configuredVenues) {
  if (pinned === "mainnet") return configured.has(venue);
  // Jupiter, Titan and the Uniswap Trading API have no testnet.
  if (pinned === "testnet") return venue !== "jupiter" && venue !== "titan" && venue !== "uniswap";
  return true;
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
