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
    // EVM swap aggregators next to Uniswap (lib/venues/aggregators).
    zerox: set(env.ZEROX_API_KEY),
    odos: set(env.ODOS_API_KEY),
    kyberswap: set(env.KYBERSWAP_CLIENT_ID),
    // Aster perps trade without a key; our builder fee only applies with NEXT_PUBLIC_ASTER_BUILDER set.
    aster: true,
    // Orderly needs our broker id on mainnet (fees go to the broker); testnet falls back to Orderly's demo broker.
    orderly: set(env.NEXT_PUBLIC_ORDERLY_BROKER_ID) || env.NEXT_PUBLIC_DEPLOYMENT === "testnet",
  };
  return Object.keys(venues)
    .filter((venue) => venues[venue])
    .join(",");
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Title, description and robots go in <head> for every visitor. Next streams them into the body for anything it
  // doesn't list as a basic bot (Googlebot included), where crawlers and Lighthouse may miss them; ours never wait
  // on data, so blocking on them costs nothing.
  htmlLimitedBots: /.*/,
  webpack(config) {
    // viem's chain index (`mainnet` for ENS lookups in lib/profile/ens.ts) pulls in ox's Tempo helpers, whose dynamic
    // import webpack can't resolve statically. That code never runs here; the warning was the build's only one.
    config.ignoreWarnings = [...(config.ignoreWarnings ?? []), { module: /node_modules[\\/]ox[\\/]_esm[\\/]tempo[\\/]/ }];
    return config;
  },
  // The terminal lives at /perp, /swap and /spot; the root is the home page.
  async redirects() {
    return [
      // The portfolio moved into the profile.
      { source: "/portfolio", destination: "/profile/portfolio", permanent: true },
      // The testnet site has no Swap view (lib/deployment.ts swapViewAvailable).
      ...(process.env.NEXT_PUBLIC_DEPLOYMENT === "testnet" ? [{ source: "/swap/:path*", destination: "/", permanent: false }] : []),
    ];
  },
  // Self-hosted fonts carry a content hash in their name.
  async headers() {
    return [
      { source: "/fonts/:file*.woff2", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      {
        // A trading screen with one-click orders must never load inside another site's frame (clickjacking).
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  env: {
    // Compared with /api/version to tell open tabs a newer deploy is live.
    NEXT_PUBLIC_COMMIT_SHA: readCommitSha(),
    NEXT_PUBLIC_CONFIGURED_VENUES: readConfiguredVenues(process.env),
  },
};

export default nextConfig;
