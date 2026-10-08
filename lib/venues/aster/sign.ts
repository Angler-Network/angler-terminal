import type { LocalAccount } from "viem";
import { ASTER_AGENT_SIGN_CHAIN, ASTER_CHAIN_NAME, ASTER_WALLET_SIGN_CHAIN } from "./config";

/**
 * Aster V3 request signing, as in Aster's demo (demo/aster-code.py) and API docs. Pure apart from the clock.
 *
 * Wallet actions (ApproveAgent, ApproveBuilder…): the request's fields become an EIP-712 struct named after the
 * action, keys capitalized and types inferred (boolean → bool, integer → uint256, else string), in the order sent.
 * Agent requests (orders, queries): the url-encoded parameters are signed as `Message { msg }`.
 */

const DOMAIN_NAME = "AsterSignTransaction";
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export type AsterValue = string | number | boolean;
export type AsterParams = Record<string, AsterValue>;

let lastSecond = 0;
let counter = 0;

/** Microsecond-style nonce: the current second × 1e6 plus a counter, unique within the second (like the demo). */
export function asterNonce(now = Date.now()) {
  const second = Math.floor(now / 1000);
  counter = second === lastSecond ? counter + 1 : 0;
  lastSecond = second;
  return second * 1_000_000 + counter;
}

const typeOf = (value: AsterValue) => (typeof value === "boolean" ? "bool" : typeof value === "number" && Number.isInteger(value) ? "uint256" : "string");
const capitalize = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

/** The typed data the wallet signs for an account action (`params` already carries asterChain, user and nonce). */
export function walletTypedData(primaryType: string, params: AsterParams) {
  const entries = Object.entries(params);
  return {
    domain: { name: DOMAIN_NAME, version: "1", chainId: ASTER_WALLET_SIGN_CHAIN, verifyingContract: ZERO },
    types: { [primaryType]: entries.map(([key, value]) => ({ name: capitalize(key), type: typeOf(value) })) },
    primaryType,
    message: Object.fromEntries(entries.map(([key, value]) => [capitalize(key), typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value])),
  } as const;
}

/** The wallet-signed form body: the action, asterChain, user, nonce, then the signature and its chain. */
export function walletParams(params: AsterParams, user: string, nonce = asterNonce()): AsterParams {
  return { ...params, asterChain: ASTER_CHAIN_NAME, user, nonce };
}

/** `a=1&b=2`, url-encoded in insertion order: what the agent signs and sends. */
export function encodeParams(params: AsterParams) {
  return new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
}

/** An agent request: the call's parameters plus asterChain, user, signer and nonce, and the signature over them. */
export async function signAgentRequest(agent: LocalAccount, user: string, params: AsterParams, nonce = asterNonce()) {
  const full: AsterParams = { ...params, asterChain: ASTER_CHAIN_NAME, user, signer: agent.address, nonce };
  const body = encodeParams(full);
  const signature = await agent.signTypedData({
    domain: { name: DOMAIN_NAME, version: "1", chainId: ASTER_AGENT_SIGN_CHAIN, verifyingContract: ZERO },
    types: { Message: [{ name: "msg", type: "string" }] },
    primaryType: "Message",
    message: { msg: body },
  });
  return `${body}&signature=${signature}`;
}
