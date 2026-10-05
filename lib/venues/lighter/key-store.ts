import type { LighterNetwork } from "./config";

/**
 * The Lighter API key lives only in this browser, scoped per network, L1 address and account index. The private
 * key is stored encrypted (AES-GCM, see key-crypto.ts) with a non-extractable device key, is never logged, never
 * sent to our server, and only used to sign locally. An API key can trade and cancel; it can't transfer funds to
 * another owner.
 */
export interface EncryptedSecret {
  /** base64 */
  iv: string;
  /** base64 */
  data: string;
}

export interface StoredLighterKey {
  apiKeyIndex: number;
  /** As returned by GenerateAPIKey ("0x" + 80 hex chars). */
  publicKey: string;
  secret: EncryptedSecret;
  createdAt: number;
}

export interface LighterRecord {
  key?: StoredLighterKey;
  /** Integrator approval the user signed, so the setup step isn't repeated. */
  integrator?: { accountIndex: number; maxTakerFee: number; expiresAt: number };
}

const PREFIX = "angler:lighter";
const KEY_PATTERN = /^0x[0-9a-fA-F]{80}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function storageKey(network: LighterNetwork, l1Address: string, accountIndex: number) {
  return `${PREFIX}:${network}:${l1Address.toLowerCase()}:${accountIndex}`;
}

function isSecret(value: unknown): value is EncryptedSecret {
  const secret = value as EncryptedSecret | null;
  return !!secret && typeof secret.iv === "string" && BASE64.test(secret.iv) && typeof secret.data === "string" && BASE64.test(secret.data);
}

function isKey(value: unknown): value is StoredLighterKey {
  const key = value as StoredLighterKey | null;
  return (
    !!key &&
    Number.isInteger(key.apiKeyIndex) &&
    key.apiKeyIndex >= 0 &&
    key.apiKeyIndex <= 254 &&
    typeof key.publicKey === "string" &&
    KEY_PATTERN.test(key.publicKey) &&
    isSecret(key.secret) &&
    typeof key.createdAt === "number"
  );
}

function isIntegrator(value: unknown): value is NonNullable<LighterRecord["integrator"]> {
  const entry = value as LighterRecord["integrator"] | null;
  return !!entry && Number.isInteger(entry.accountIndex) && Number.isInteger(entry.maxTakerFee) && typeof entry.expiresAt === "number";
}

export function readLighterRecord(
  storage: Pick<Storage, "getItem">,
  network: LighterNetwork,
  l1Address: string,
  accountIndex: number,
): LighterRecord {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(network, l1Address, accountIndex)) ?? "{}") as LighterRecord;
    return {
      key: isKey(parsed.key) ? parsed.key : undefined,
      integrator: isIntegrator(parsed.integrator) ? parsed.integrator : undefined,
    };
  } catch {
    return {};
  }
}

export function writeLighterRecord(
  storage: Pick<Storage, "setItem" | "removeItem">,
  network: LighterNetwork,
  l1Address: string,
  accountIndex: number,
  record: LighterRecord,
) {
  const key = storageKey(network, l1Address, accountIndex);
  if (!record.key && !record.integrator) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(record));
}

/** The API returns public keys without "0x" and in any case. */
export function samePublicKey(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return a.replace(/^0x/i, "").toLowerCase() === b.replace(/^0x/i, "").toLowerCase();
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
