import "server-only";
import { ROUTER_URLS, readArcusNetwork } from "./config";

const TIMEOUT_MS = 15_000;

/**
 * Arcus partner settings, server only. A partner key (from Arcus) is sent as X-Api-Key and is required for the
 * builder fee; without one the router still works, just without a fee.
 */
export function readArcusServerConfig(env: Record<string, string | undefined>) {
  const apiKey = env.ARCUS_API_KEY?.trim() || null;
  const fee = Number(env.ARCUS_BUILDER_FEE_BPS);
  return {
    network: readArcusNetwork(env.NEXT_PUBLIC_ARCUS_NETWORK),
    apiKey,
    builderFeeBps: apiKey && Number.isInteger(fee) && fee > 0 && fee <= 1000 ? fee : null,
  };
}

/** Calls the Arcus spot router. The mainnet router only allows listed origins, so the browser goes through here. */
export function arcusFetch(path: string, init: RequestInit & { next?: { revalidate: number } } = {}) {
  const { network, apiKey } = readArcusServerConfig(process.env);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (apiKey) headers.set("x-api-key", apiKey);
  return fetch(`${ROUTER_URLS[network]}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}
