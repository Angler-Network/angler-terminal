"use client";

import { decryptSecret, getDeviceKey } from "../lighter/key-crypto";
import type { EncryptedSecret } from "../lighter/key-store";
import { orderlyConfig } from "./config";

/** This browser's saved Orderly trading key per wallet (encrypted), and its readers, without the signing code. */

export interface OrderlyRecord {
  accountId: string;
  publicKey: string;
  secret: EncryptedSecret;
  expiration: number;
}

export interface OrderlyOnboarding {
  /** null until checked. */
  registered: boolean | null;
  keyReady: boolean;
  accountId: string | null;
}

const storageKey = (user: string) => `angler:orderly:${orderlyConfig.network}:${orderlyConfig.brokerId}:${user.toLowerCase()}`;

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readOrderlyRecord(user: string): OrderlyRecord | null {
  try {
    const parsed = JSON.parse(storage()?.getItem(storageKey(user)) ?? "null") as OrderlyRecord | null;
    if (!parsed || typeof parsed.accountId !== "string" || typeof parsed.publicKey !== "string" || !parsed.secret?.iv) return null;
    return parsed.expiration > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

export function writeOrderlyRecord(user: string, record: OrderlyRecord) {
  storage()?.setItem(storageKey(user), JSON.stringify(record));
  cache.delete(user.toLowerCase());
}

const cache = new Map<string, Promise<{ accountId: string; secret: string }>>();

/** The decrypted trading key for signing, or null before setup (decrypted once per page). */
export function orderlyKey(user: string): Promise<{ accountId: string; secret: string }> | null {
  const record = readOrderlyRecord(user);
  if (!record) return null;
  const id = user.toLowerCase();
  let entry = cache.get(id);
  if (!entry) {
    entry = getDeviceKey().then(async (device) => ({ accountId: record.accountId, secret: await decryptSecret(device, record.secret) }));
    entry.catch(() => cache.delete(id));
    cache.set(id, entry);
  }
  return entry;
}

/** Forgets the key here; it can only read and trade, and it expires within a year. */
export function forgetOrderlyKey(user: string) {
  storage()?.removeItem(storageKey(user));
  cache.delete(user.toLowerCase());
}
