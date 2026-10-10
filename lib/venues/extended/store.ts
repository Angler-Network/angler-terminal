"use client";

import { decryptSecret, getDeviceKey } from "../lighter/key-crypto";
import type { EncryptedSecret } from "../lighter/key-store";
import { extendedConfig } from "./config";

/**
 * This browser's Extended session per wallet: the account, its Stark key and its API key, both secrets AES-GCM encrypted
 * with the non-extractable device key (`lighter/key-crypto.ts`). Never log or send the Stark key; the API key only
 * travels in the X-Api-Key header to Extended through our proxy.
 */

export interface ExtendedRecord {
  accountId: number;
  vault: string;
  publicKey: string;
  starkKey: EncryptedSecret;
  apiKey: EncryptedSecret;
}

export interface ExtendedOnboarding {
  /** null until checked. */
  ready: boolean | null;
  accountId: number | null;
}

export interface ExtendedSession {
  accountId: number;
  vault: string;
  publicKey: string;
  starkKey: string;
  apiKey: string;
}

const storageKey = (user: string) => `angler:extended:${extendedConfig.network}:${user.toLowerCase()}`;

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readExtendedRecord(user: string): ExtendedRecord | null {
  try {
    const parsed = JSON.parse(storage()?.getItem(storageKey(user)) ?? "null") as ExtendedRecord | null;
    if (!parsed || !Number.isSafeInteger(parsed.accountId) || typeof parsed.vault !== "string" || typeof parsed.publicKey !== "string") return null;
    return parsed.starkKey?.iv && parsed.apiKey?.iv ? parsed : null;
  } catch {
    return null;
  }
}

export function writeExtendedRecord(user: string, record: ExtendedRecord) {
  storage()?.setItem(storageKey(user), JSON.stringify(record));
  cache.delete(user.toLowerCase());
}

const cache = new Map<string, Promise<ExtendedSession>>();

/** The decrypted session for signing and private reads, or null before setup (decrypted once per page). */
export function extendedSession(user: string): Promise<ExtendedSession> | null {
  const record = readExtendedRecord(user);
  if (!record) return null;
  const id = user.toLowerCase();
  let entry = cache.get(id);
  if (!entry) {
    entry = getDeviceKey().then(async (device) => ({
      accountId: record.accountId,
      vault: record.vault,
      publicKey: record.publicKey,
      starkKey: await decryptSecret(device, record.starkKey),
      apiKey: await decryptSecret(device, record.apiKey),
    }));
    entry.catch(() => cache.delete(id));
    cache.set(id, entry);
  }
  return entry;
}

/** Forgets the keys here. The Stark key comes back from the same wallet signature; a new API key is minted then. */
export function forgetExtendedKey(user: string) {
  storage()?.removeItem(storageKey(user));
  cache.delete(user.toLowerCase());
}
