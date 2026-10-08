import { ed25519 } from "@noble/curves/ed25519";
import { base58, base64urlnopad } from "@scure/base";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import { ORDERLY_OFFCHAIN_VERIFIER } from "./config";

/**
 * Orderly signing (docs: API Authentication, Accounts, Wallet Authentication). Pure apart from randomness.
 * - Account id: keccak256(abi.encode(address, keccak256(brokerId))).
 * - The wallet signs EIP-712 `Registration` and `AddOrderlyKey` on the off-chain domain ("Orderly", "1", the chain the
 *   wallet is on, a fixed verifying contract).
 * - Every private request carries an ed25519 signature of `timestamp + METHOD + path?query + body`, base64url.
 */

export function orderlyAccountId(address: `0x${string}`, brokerId: string) {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [address, keccak256(toHex(brokerId))]));
}

/** keccak256 of a plain string ("USDC", a broker id), as the vault's deposit struct wants. */
export function orderlyHash(text: string) {
  return keccak256(toHex(text));
}

export function offchainDomain(chainId: number) {
  return { name: "Orderly", version: "1", chainId, verifyingContract: ORDERLY_OFFCHAIN_VERIFIER } as const;
}

export const REGISTRATION_TYPES = {
  Registration: [
    { name: "brokerId", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "timestamp", type: "uint64" },
    { name: "registrationNonce", type: "uint256" },
  ],
} as const;

export const ADD_KEY_TYPES = {
  AddOrderlyKey: [
    { name: "brokerId", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "orderlyKey", type: "string" },
    { name: "scope", type: "string" },
    { name: "timestamp", type: "uint64" },
    { name: "expiration", type: "uint64" },
  ],
} as const;

/** A new trading key: the secret (base58, kept encrypted in this browser) and its public form "ed25519:<base58>". */
export function newOrderlyKey() {
  const secret = ed25519.utils.randomPrivateKey();
  return { secret: base58.encode(secret), publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
}

export function orderlyPublicKey(secret: string) {
  return `ed25519:${base58.encode(ed25519.getPublicKey(base58.decode(secret)))}`;
}

/** The exact string Orderly verifies: timestamp, upper-case method, path with its query, then the body as sent. */
export function orderlyMessage(timestamp: number, method: string, pathWithQuery: string, body: string) {
  return `${timestamp}${method.toUpperCase()}${pathWithQuery}${body}`;
}

/** Headers for a private request signed by the trading key. */
export function orderlyHeaders(secret: string, accountId: string, timestamp: number, method: string, pathWithQuery: string, body: string) {
  const signature = ed25519.sign(new TextEncoder().encode(orderlyMessage(timestamp, method, pathWithQuery, body)), base58.decode(secret));
  return {
    "content-type": method === "GET" || method === "DELETE" ? "application/x-www-form-urlencoded" : "application/json",
    "orderly-account-id": accountId,
    "orderly-key": orderlyPublicKey(secret),
    "orderly-timestamp": String(timestamp),
    // base64url; Orderly's samples keep the padding off.
    "orderly-signature": base64urlnopad.encode(signature),
  };
}
