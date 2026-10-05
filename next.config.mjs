import { execSync } from "node:child_process";

function readCommitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  env: {
    // Compared with /api/version to tell open tabs a newer deploy is live.
    NEXT_PUBLIC_COMMIT_SHA: readCommitSha(),
  },
};

export default nextConfig;
