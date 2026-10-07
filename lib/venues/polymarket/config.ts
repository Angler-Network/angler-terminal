/**
 * Polymarket builder settings. The builder code (bytes32, public: it's written into every signed order) attributes
 * volume and our builder fee; the builder API key, secret and passphrase stay on the server and only sign requests
 * through `/api/prediction/polymarket/sign`.
 */

const BUILDER_CODE = /^0x[0-9a-fA-F]{64}$/;

export function readBuilderCode(value: string | undefined) {
  const code = value?.trim();
  return code && BUILDER_CODE.test(code) && !/^0x0+$/.test(code) ? code : null;
}

// Next.js inlines NEXT_PUBLIC_* only when accessed by their full name.
export const polymarketBuilderCode = readBuilderCode(process.env.NEXT_PUBLIC_POLYMARKET_BUILDER_CODE);

export const POLYGON_CHAIN_ID = 137;

/** Requests the SDK asks the builder key to sign: non-GET CLOB calls (orders, cancels) and relayer submissions. */
export function isSignableBuilderRequest(method: unknown, path: unknown) {
  if (method !== "POST" && method !== "DELETE") return false;
  return typeof path === "string" && /^\/[a-z0-9/_-]{1,60}$/i.test(path) && !path.includes("..");
}
