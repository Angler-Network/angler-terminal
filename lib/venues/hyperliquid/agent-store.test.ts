import { describe, expect, it } from "vitest";
import { readOnboarding, storageKey, writeOnboarding } from "./agent-store";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const USER = "0xAbC0000000000000000000000000000000000001";
const agent = {
  address: "0x1111111111111111111111111111111111111111" as const,
  privateKey: `0x${"ab".repeat(32)}` as const,
  name: "angler terminal",
  createdAt: 1,
};

describe("agent store", () => {
  it("scopes records by network and lowercased user", () => {
    expect(storageKey("testnet", USER)).toBe(`angler:hl:testnet:${USER.toLowerCase()}`);
    const storage = memoryStorage();
    writeOnboarding(storage, "testnet", USER, { agent });
    expect(readOnboarding(storage, "testnet", USER.toLowerCase()).agent).toEqual(agent);
    expect(readOnboarding(storage, "mainnet", USER).agent).toBeUndefined();
  });

  it("drops malformed agents and survives bad JSON", () => {
    const storage = memoryStorage();
    storage.setItem(storageKey("testnet", USER), JSON.stringify({ agent: { ...agent, privateKey: "0x12" } }));
    expect(readOnboarding(storage, "testnet", USER).agent).toBeUndefined();
    storage.setItem(storageKey("testnet", USER), "{nope");
    expect(readOnboarding(storage, "testnet", USER)).toEqual({});
  });

  it("removes the record once nothing is left", () => {
    const storage = memoryStorage();
    writeOnboarding(storage, "testnet", USER, { agent });
    writeOnboarding(storage, "testnet", USER, {});
    expect(storage.data.size).toBe(0);
  });
});
