/** Commit the browser bundle was built from (inlined at build time by next.config.mjs). */
export const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "";

export const shortCommitSha = commitSha.slice(0, 7);
