import "server-only";

export const LIFI_API_URL = "https://li.quest/v1";
const TIMEOUT_MS = 20_000;
/** Our fee's cap, in bps of the input. */
export const LIFI_MAX_FEE_BPS = 300;

/** The quote parameters the browser may set; anything else (integrator, fee, referrer, allowed bridges) is dropped. */
const QUOTE_PARAMS = ["fromChain", "toChain", "fromToken", "toToken", "fromAmount", "fromAddress", "toAddress", "slippage"] as const;
/**
 * Bridges to leave out, for a second route to choose from (the first quote's bridge denied). It can only narrow LI.FI's
 * own vetted choice, never force one: tool keys only ("relaydepository", "mayan"), at most five, no "all".
 */
const DENY_BRIDGES = /^(?!all(,|$))[a-z0-9-]{2,40}(,(?!all(,|$))[a-z0-9-]{2,40}){0,4}$/;

/**
 * LI.FI settings, server only, all optional: LIFI_INTEGRATOR (the integrator name registered on portal.li.fi, where
 * the fee wallets are set per chain), LIFI_FEE_BPS (whole bps ≤ 300, only with an integrator; fees go to those
 * wallets) and LIFI_API_KEY (higher rate limits). A malformed fee turns the fee off.
 */
export function readLifiServerConfig(env: Record<string, string | undefined>) {
  const apiKey = env.LIFI_API_KEY?.trim() || null;
  const integrator = env.LIFI_INTEGRATOR?.trim() || null;
  const bps = Number(env.LIFI_FEE_BPS);
  const fee = integrator && Number.isInteger(bps) && bps > 0 && bps <= LIFI_MAX_FEE_BPS ? String(bps / 10_000) : null;
  return { apiKey, integrator: integrator && /^[A-Za-z0-9._-]{1,23}$/.test(integrator) ? integrator : null, fee };
}

/** The upstream quote query: the browser's allowed parameters plus our integrator and fee. Null when one is missing. */
export function lifiQuoteQuery(search: URLSearchParams, config: ReturnType<typeof readLifiServerConfig>) {
  const query = new URLSearchParams();
  for (const name of QUOTE_PARAMS) {
    const value = search.get(name)?.trim();
    if (value) query.set(name, value.slice(0, 120));
    else if (name !== "slippage") return null;
  }
  const deny = search.get("denyBridges")?.trim();
  if (deny && DENY_BRIDGES.test(deny)) query.set("denyBridges", deny);
  if (config.integrator) query.set("integrator", config.integrator);
  if (config.fee) query.set("fee", config.fee);
  return query;
}

export function lifiFetch(path: string, apiKey: string | null) {
  const headers = new Headers({ accept: "application/json" });
  if (apiKey) headers.set("x-lifi-api-key", apiKey);
  return fetch(`${LIFI_API_URL}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
}
