import type { EncryptedSecret } from "./key-store";

/**
 * Encrypts the Lighter API private key at rest, as Lighter's docs recommend for browser keys: AES-GCM with a
 * non-extractable WebCrypto key. The CryptoKey object itself is kept in IndexedDB (structured clone keeps it
 * non-extractable), so the raw key material never exists in JavaScript or in localStorage.
 */

const DB_NAME = "angler-terminal";
const STORE = "crypto-keys";
const DEVICE_KEY_ID = "lighter-device-key";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function encryptSecret(key: CryptoKey, plaintext: string, subtle: SubtleCrypto = crypto.subtle): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

export async function decryptSecret(key: CryptoKey, secret: EncryptedSecret, subtle: SubtleCrypto = crypto.subtle) {
  const plaintext = await subtle.decrypt({ name: "AES-GCM", iv: fromBase64(secret.iv) }, key, fromBase64(secret.data));
  return new TextDecoder().decode(plaintext);
}

export function generateDeviceKey(subtle: SubtleCrypto = crypto.subtle) {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let deviceKey: Promise<CryptoKey> | null = null;

/** This browser's device key, created on first use. Clearing site data drops it, and with it every stored key. */
export function getDeviceKey() {
  deviceKey ??= (async () => {
    const db = await openDb();
    try {
      const existing = await run<CryptoKey | undefined>(db, "readonly", (store) => store.get(DEVICE_KEY_ID) as IDBRequest<CryptoKey | undefined>);
      if (existing) return existing;
      const created = await generateDeviceKey();
      await run(db, "readwrite", (store) => store.put(created, DEVICE_KEY_ID));
      return created;
    } finally {
      db.close();
    }
  })();
  deviceKey.catch(() => {
    deviceKey = null;
  });
  return deviceKey;
}
