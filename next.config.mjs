import { execSync } from "node:child_process";

function readCommitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

/**
 * Venues whose required settings are present in this build, as a comma list for the browser (names only, never the
 * values). On the mainnet site (NEXT_PUBLIC_DEPLOYMENT=mainnet) venues missing from it stay off.
 */
function readConfiguredVenues(env) {
  const set = (value) => typeof value === "string" && value.trim() !== "";
  const builder = env.NEXT_PUBLIC_HL_BUILDER_ADDRESS ?? "";
  const venues = {
    hyperliquid: /^0x[0-9a-fA-F]{40}$/.test(builder) && !/^0x0{40}$/.test(builder),
    // Both Lighter exchanges (core and Robinhood Chain) trade without partner settings.
    lighter: true,
    lighterRh: true,
    jupiter: set(env.JUP_API_KEY),
    titan: set(env.TITAN_API_KEY),
    // The Arcus router quotes and fills through our proxy without a key (checked on mainnet); ARCUS_API_KEY only adds
    // our builder fee. Gating on it left mainnet stock swaps on Uniswap alone.
    arcus: true,
    uniswap: set(env.UNISWAP_API_KEY),
  };
  return Object.keys(venues)
    .filter((venue) => venues[venue])
    .join(",");
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // The terminal lives at /perp, /swap and /spot; the old root keeps working for bookmarks and shared links.
  async redirects() {
    return [
      { source: "/", destination: "/perp", permanent: false },
      // The portfolio moved into the profile.
      { source: "/portfolio", destination: "/profile/portfolio", permanent: true },
    ];
  },
  // Self-hosted fonts carry a content hash in their name.
  async headers() {
    return [{ source: "/fonts/:file*.woff2", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
  env: {
    // Compared with /api/version to tell open tabs a newer deploy is live.
    NEXT_PUBLIC_COMMIT_SHA: readCommitSha(),
    NEXT_PUBLIC_CONFIGURED_VENUES: readConfiguredVenues(process.env),
  },
};

export default nextConfig;
