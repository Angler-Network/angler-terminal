import "server-only";
import { UNISWAP_API_URL, UNISWAP_MAX_FEE_BPS } from "./config";

const TIMEOUT_MS = 20_000;
/** Universal Router sentinels and the zero address can't receive a fee (the API refuses them). */
const RESERVED_RECIPIENTS = new Set(["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"]);

export interface UniswapFee {
  bips: number;
  recipient: string;
}

/**
 * Uniswap settings, server only: UNISWAP_API_KEY (developers.uniswap.org dashboard) and the integrator fee
 * UNISWAP_FEE_BPS (≤ 500, two decimals at most) paid to UNISWAP_FEE_RECIPIENT. A malformed fee setting turns the fee
 * off rather than failing every quote.
 */
export function readUniswapServerConfig(env: Record<string, string | undefined>) {
  const apiKey = env.UNISWAP_API_KEY?.trim() || null;
  const recipient = env.UNISWAP_FEE_RECIPIENT?.trim() ?? "";
  const bips = Number(env.UNISWAP_FEE_BPS);
  const validRecipient = /^0x[0-9a-fA-F]{40}$/.test(recipient) && !RESERVED_RECIPIENTS.has(recipient.toLowerCase());
  const validBips = Number.isFinite(bips) && bips > 0 && bips <= UNISWAP_MAX_FEE_BPS && Math.round(bips * 100) === bips * 100;
  const fee: UniswapFee | null = validRecipient && validBips ? { bips, recipient } : null;
  return { apiKey, fee };
}

/**
 * Adds our fee to a /quote body, replacing whatever the browser sent: only the server decides it. Fractional bps
 * need Universal Router 2.1.1, which the caller pins with the returned header.
 */
export function withIntegratorFee(body: Record<string, unknown>, fee: UniswapFee | null) {
  const next = { ...body };
  delete next.integratorFees;
  if (fee) next.integratorFees = [fee];
  const headers: Record<string, string> = fee && !Number.isInteger(fee.bips) ? { "x-universal-router-version": "2.1.1" } : {};
  return { body: next, headers };
}

export function uniswapFetch(path: string, apiKey: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-api-key", apiKey);
  return fetch(`${UNISWAP_API_URL}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
}
