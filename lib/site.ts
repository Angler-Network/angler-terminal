import { deployment as currentDeployment, type Deployment } from "./deployment";

/** Commit the browser bundle was built from (inlined at build time by next.config.mjs). */
export const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "";

export const shortCommitSha = commitSha.slice(0, 7);

export const SITE_URLS: Record<Deployment, string> = {
  mainnet: "https://trade.angler.network",
  testnet: "https://testnet-trade.angler.network",
};

/**
 * Canonical origin for metadata, robots.txt and the sitemap: NEXT_PUBLIC_SITE_URL when set, else the deployment's
 * site, else localhost (unpinned builds).
 */
export function siteUrl(deployment: Deployment | null = currentDeployment, explicit = process.env.NEXT_PUBLIC_SITE_URL) {
  const url = explicit?.trim().replace(/\/+$/, "");
  if (url && /^https?:\/\/[^/\s]+$/.test(url)) return url;
  return deployment ? SITE_URLS[deployment] : "http://localhost:3000";
}

/** Both sites are indexed, each under its own canonical origin; unpinned builds are dev ones and stay out. */
export function isIndexable(deployment: Deployment | null = currentDeployment) {
  return deployment !== null;
}
