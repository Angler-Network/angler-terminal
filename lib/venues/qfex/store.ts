"use client";

import { decryptSecret, encryptSecret, getDeviceKey } from "../lighter/key-crypto";
import type { EncryptedSecret } from "../lighter/key-store";

/**
 * The QFEX API key this browser trades with, per wallet: the public key as is, the secret AES-GCM encrypted with the
 * non-extractable device key (`lighter/key-crypto.ts`). The user creates the key on qfex.com and pastes it here; the
 * secret only signs HMACs in this browser and is never sent anywhere (the proxy sees signatures, not the secret).
 */

export interface QfexRecord {
  publicKey: string;
  secret: EncryptedSecret;
}

export interface QfexSession {
  publicKey: string;
  secret: string;
}

export interface QfexOnboarding {
  ready: boolean;
  publicKey: string | null;
}

/** QFEX key pairs as its Developer Settings show them. */
export const QFEX_PUBLIC_KEY = /^qfex_pub_[A-Za-z0-9_-]{8,200}$/;
export const QFEX_SECRET_KEY = /^qfex_secret_[A-Za-z0-9_-]{8,200}$/;

const storageKey = (user: string) => `angler:qfex:${user.toLowerCase()}`;

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readQfexRecord(user: string): QfexRecord | null {
  try {
    const parsed = JSON.parse(storage()?.getItem(storageKey(user)) ?? "null") as QfexRecord | null;
    return parsed && QFEX_PUBLIC_KEY.test(parsed.publicKey) && parsed.secret?.iv ? parsed : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<QfexSession>>();

export async function writeQfexKey(user: string, publicKey: string, secret: string) {
  const record: QfexRecord = { publicKey, secret: await encryptSecret(await getDeviceKey(), secret) };
  storage()?.setItem(storageKey(user), JSON.stringify(record));
  cache.delete(user.toLowerCase());
}

/** The decrypted key pair for signing, or null before setup (decrypted once per page). */
export function qfexSession(user: string): Promise<QfexSession> | null {
  const record = readQfexRecord(user);
  if (!record) return null;
  const id = user.toLowerCase();
  let entry = cache.get(id);
  if (!entry) {
    entry = getDeviceKey().then(async (device) => ({ publicKey: record.publicKey, secret: await decryptSecret(device, record.secret) }));
    entry.catch(() => cache.delete(id));
    cache.set(id, entry);
  }
  return entry;
}

export function forgetQfexKey(user: string) {
  storage()?.removeItem(storageKey(user));
  cache.delete(user.toLowerCase());
}
