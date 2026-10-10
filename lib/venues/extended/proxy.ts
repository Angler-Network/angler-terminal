import { extendedRestricted } from "./geo";

/**
 * What our Extended proxy relays (`app/api/extended/[network]/[...path]`): only the paths the terminal uses, and only
 * the public market data for visitors from Extended's restricted countries. Pure: tested.
 */

export type ExtendedProxyMethod = "GET" | "POST" | "PATCH" | "DELETE";

const RULES: Array<{ method: ExtendedProxyMethod; path: RegExp; public?: boolean; testnetOnly?: boolean }> = [
  { method: "GET", path: /^\/api\/v1\/info\/[\w/.-]+$/, public: true },
  { method: "POST", path: /^\/auth\/onboard$/ },
  { method: "POST", path: /^\/api\/v1\/user\/account\/api-key$/ },
  { method: "GET", path: /^\/api\/v1\/user\/(account\/info|accounts|balance|positions|orders|fees|leverage|trades)$/ },
  { method: "GET", path: /^\/api\/v1\/user\/orders\/external\/[\w-]{1,100}$/ },
  { method: "POST", path: /^\/api\/v1\/user\/order$/ },
  { method: "DELETE", path: /^\/api\/v1\/user\/order$/ },
  { method: "PATCH", path: /^\/api\/v1\/user\/leverage$/ },
  { method: "POST", path: /^\/api\/v1\/user\/claim$/, testnetOnly: true },
];

/** Headers passed through to Extended (request side); everything else is dropped. */
export const EXTENDED_FORWARD_HEADERS = ["x-api-key", "l1_signature", "l1_message_time", "x-x10-active-account", "content-type"];

export type ProxyDecision = { ok: true } | { ok: false; status: number; restricted?: boolean };

export function extendedProxyDecision(input: { method: string; path: string; network: string; country: string | null; region: string | null; pinned: "mainnet" | "testnet" | null }): ProxyDecision {
  if (input.network !== "mainnet" && input.network !== "testnet") return { ok: false, status: 404 };
  // A pinned site relays only its own network.
  if (input.pinned && input.network !== input.pinned) return { ok: false, status: 404 };
  const rule = RULES.find((entry) => entry.method === input.method && entry.path.test(input.path));
  if (!rule || (rule.testnetOnly && input.network !== "testnet")) return { ok: false, status: 404 };
  if (!rule.public && extendedRestricted(input.country, input.region)) return { ok: false, status: 451, restricted: true };
  return { ok: true };
}
