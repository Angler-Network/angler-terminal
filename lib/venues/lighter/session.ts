"use client";

import { VenueError } from "../types";
import { getAccountIndex, nextNonce, sendTx, txStatus } from "./api";
import { lighterConfig } from "./config";
import { LighterApiError } from "./errors";
import { decryptSecret, getDeviceKey } from "./key-crypto";
import { browserStorage, readLighterRecord, writeLighterRecord, type LighterRecord } from "./key-store";
import { NonceQueue } from "./nonce";
import { createAuthToken, type SignedTx, type SignerContext } from "./signer";

/** A user's Lighter account with a usable (locally stored) API key. */
export interface LighterSession {
  l1Address: string;
  accountIndex: number;
  record: LighterRecord;
  signer: SignerContext;
}

export function readRecord(l1Address: string, accountIndex: number): LighterRecord {
  const storage = browserStorage();
  return storage ? readLighterRecord(storage, lighterConfig.network, l1Address, accountIndex) : {};
}

export function updateRecord(l1Address: string, accountIndex: number, change: (record: LighterRecord) => LighterRecord) {
  const storage = browserStorage();
  if (!storage) throw new VenueError("Browser storage is unavailable, so a Lighter trading key can't be kept.");
  writeLighterRecord(storage, lighterConfig.network, l1Address, accountIndex, change(readLighterRecord(storage, lighterConfig.network, l1Address, accountIndex)));
}

/** The session for this wallet, or null when it has no Lighter account or no stored key. */
export async function loadSession(l1Address: string): Promise<LighterSession | null> {
  const accountIndex = await getAccountIndex(l1Address);
  if (accountIndex === null) return null;
  const record = readRecord(l1Address, accountIndex);
  if (!record.key) return null;
  let privateKey: string;
  try {
    privateKey = await decryptSecret(await getDeviceKey(), record.key.secret);
  } catch {
    // The device key is gone (site data cleared) or the record is corrupt: the key must be registered again.
    updateRecord(l1Address, accountIndex, ({ key: _dropped, ...rest }) => rest);
    return null;
  }
  return {
    l1Address,
    accountIndex,
    record,
    signer: { privateKey, chainId: lighterConfig.chainId, apiKeyIndex: record.key.apiKeyIndex, accountIndex },
  };
}

export async function requireSession(l1Address: string) {
  const session = await loadSession(l1Address);
  if (!session) throw new VenueError("Set up Lighter trading first: register a trading key for this wallet.");
  return session;
}

const queues = new Map<string, NonceQueue>();

function queueKey(accountIndex: number, apiKeyIndex: number) {
  return `${lighterConfig.network}:${accountIndex}:${apiKeyIndex}`;
}

export function nonceQueue(accountIndex: number, apiKeyIndex: number) {
  const key = queueKey(accountIndex, apiKeyIndex);
  let queue = queues.get(key);
  if (!queue) {
    queue = new NonceQueue(() => nextNonce(accountIndex, apiKeyIndex));
    queues.set(key, queue);
  }
  return queue;
}

/**
 * Signs with the next nonce and submits, one tx at a time per key. Resolves with the tx hash once the API accepted
 * it; execution still has to be confirmed.
 */
export function signAndSend(session: LighterSession, sign: (nonce: number) => Promise<SignedTx>) {
  return nonceQueue(session.accountIndex, session.signer.apiKeyIndex).run(async (nonce) => {
    const tx = await sign(nonce);
    return { value: await sendTx(tx), consumed: true };
  });
}

const AUTH_TTL_S = 6 * 3600;
const AUTH_MARGIN_S = 600;
const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Auth token for private endpoints and channels (max 8h), reused until 10 minutes before it expires. */
export async function authToken(session: LighterSession) {
  const key = `${queueKey(session.accountIndex, session.signer.apiKeyIndex)}:${session.signer.privateKey.slice(-8)}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - AUTH_MARGIN_S > now) return cached.token;
  const expiresAt = now + AUTH_TTL_S;
  const token = await createAuthToken(session.signer, expiresAt);
  tokens.set(key, { token, expiresAt });
  return token;
}

export function forgetSessionCaches(accountIndex: number, apiKeyIndex: number) {
  const key = queueKey(accountIndex, apiKeyIndex);
  queues.get(key)?.reset();
  for (const id of tokens.keys()) if (id.startsWith(`${key}:`)) tokens.delete(id);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until an accepted tx executed. Throws a readable error when the sequencer rejected it. */
export async function waitForTx(hash: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tx = await txStatus(hash);
    if (tx?.status === 2) return;
    if (tx?.status === 0) {
      let reason = "";
      try {
        reason = String((JSON.parse(tx.eventInfo) as { ae?: unknown }).ae ?? "");
      } catch {}
      throw new LighterApiError(0, reason || "Lighter rejected the transaction.");
    }
    await sleep(1000);
  }
  throw new VenueError("Lighter accepted the transaction but hasn't executed it yet. Check again in a moment.");
}
