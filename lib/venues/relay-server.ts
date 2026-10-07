import "server-only";

export const RELAY_API_URL = "https://api.relay.link";
const TIMEOUT_MS = 15_000;
/** Our app fee's cap, in bps of the input. */
export const RELAY_MAX_FEE_BPS = 500;

/**
 * Relay settings, server only, all optional: RELAY_FEE_BPS (whole bps, ≤ 500) paid to RELAY_FEE_RECIPIENT (an EVM
 * address; fees accrue there and are claimed in Relay's app), and RELAY_API_KEY for higher rate limits, which also
 * lets quotes carry our referrer name. A malformed fee setting turns the fee off.
 */
export function readRelayServerConfig(env: Record<string, string | undefined>) {
  const apiKey = env.RELAY_API_KEY?.trim() || null;
  const recipient = env.RELAY_FEE_RECIPIENT?.trim() ?? "";
  const bps = Number(env.RELAY_FEE_BPS);
  const fee =
    /^0x[0-9a-fA-F]{40}$/.test(recipient) && !/^0x0{40}$/.test(recipient) && Number.isInteger(bps) && bps > 0 && bps <= RELAY_MAX_FEE_BPS
      ? { recipient, fee: String(bps) }
      : null;
  return { apiKey, fee };
}

/** Our fee (and referrer, with a key) on a quote body; whatever the browser sent for them is dropped. */
export function withRelayFee(body: Record<string, unknown>, config: ReturnType<typeof readRelayServerConfig>) {
  const next = { ...body };
  delete next.appFees;
  delete next.referrer;
  if (config.fee) next.appFees = [config.fee];
  if (config.apiKey) next.referrer = "angler.network";
  return next;
}

export function relayFetch(path: string, apiKey: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (apiKey) headers.set("x-api-key", apiKey);
  return fetch(`${RELAY_API_URL}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
}
