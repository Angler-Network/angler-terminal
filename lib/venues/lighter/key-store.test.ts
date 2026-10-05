import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateDeviceKey } from "./key-crypto";
import { readLighterRecord, samePublicKey, storageKey, writeLighterRecord, type StoredLighterKey } from "./key-store";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const L1 = "0xAbCDEF0000000000000000000000000000000001";
const PUBLIC_KEY = `0x${"ab".repeat(40)}`;
const KEY: StoredLighterKey = { apiKeyIndex: 61, publicKey: PUBLIC_KEY, secret: { iv: "AAAAAAAAAAAAAAAA", data: "c2VjcmV0" }, createdAt: 1 };

describe("Lighter key storage", () => {
  it("scopes records per network, L1 address and account index", () => {
    expect(storageKey("testnet", L1, 7)).toBe(`angler:lighter:testnet:${L1.toLowerCase()}:7`);
    const storage = memoryStorage();
    writeLighterRecord(storage, "testnet", L1, 7, { key: KEY });
    expect(readLighterRecord(storage, "testnet", L1.toLowerCase(), 7)).toEqual({ key: KEY, integrator: undefined });
    expect(readLighterRecord(storage, "mainnet", L1, 7)).toEqual({});
    expect(readLighterRecord(storage, "testnet", L1, 8)).toEqual({});
  });

  it("never stores a plaintext private key field", () => {
    const storage = memoryStorage();
    writeLighterRecord(storage, "testnet", L1, 7, { key: KEY });
    expect([...storage.data.values()].join()).not.toMatch(/privateKey/);
  });

  it("drops malformed records and removes empty ones", () => {
    const storage = memoryStorage();
    storage.setItem(storageKey("testnet", L1, 7), JSON.stringify({ key: { ...KEY, publicKey: "0x12" }, integrator: { accountIndex: "x" } }));
    expect(readLighterRecord(storage, "testnet", L1, 7)).toEqual({ key: undefined, integrator: undefined });
    storage.setItem(storageKey("testnet", L1, 7), "{not json");
    expect(readLighterRecord(storage, "testnet", L1, 7)).toEqual({});
    writeLighterRecord(storage, "testnet", L1, 7, {});
    expect(storage.data.size).toBe(0);
  });

  it("compares public keys with or without 0x", () => {
    expect(samePublicKey(PUBLIC_KEY, PUBLIC_KEY.slice(2).toUpperCase())).toBe(true);
    expect(samePublicKey(PUBLIC_KEY, "")).toBe(false);
  });

  it("encrypts the private key with a non-extractable device key", async () => {
    const subtle = webcrypto.subtle as unknown as SubtleCrypto;
    const deviceKey = await generateDeviceKey(subtle);
    expect(deviceKey.extractable).toBe(false);
    const privateKey = `0x${"12".repeat(40)}`;
    const secret = await encryptSecret(deviceKey, privateKey, subtle);
    expect(secret.data).not.toContain("1212");
    expect(await decryptSecret(deviceKey, secret, subtle)).toBe(privateKey);
    await expect(decryptSecret(await generateDeviceKey(subtle), secret, subtle)).rejects.toThrow();
  });
});
