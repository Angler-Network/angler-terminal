import { describe, expect, it, vi } from "vitest";
import { INVALID_NONCE_CODE, NonceQueue } from "./nonce";

class ApiError extends Error {
  constructor(readonly code: number) {
    super(String(code));
  }
}

describe("NonceQueue", () => {
  it("serializes sends and counts locally", async () => {
    const fetchNonce = vi.fn(async () => 5);
    const queue = new NonceQueue(fetchNonce);
    const seen: number[] = [];
    const send = async (nonce: number) => {
      seen.push(nonce);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { value: nonce, consumed: true };
    };
    await Promise.all([queue.run(send), queue.run(send), queue.run(send)]);
    expect(seen).toEqual([5, 6, 7]);
    expect(fetchNonce).toHaveBeenCalledTimes(1);
  });

  it("keeps the nonce after an API rejection", async () => {
    const queue = new NonceQueue(async () => 1);
    await expect(queue.run(async () => Promise.reject(new ApiError(21739)))).rejects.toThrow();
    expect(await queue.run(async (nonce) => ({ value: nonce, consumed: true }))).toBe(1);
  });

  it("refetches and retries once on invalid nonce", async () => {
    const fetchNonce = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(9);
    const queue = new NonceQueue(fetchNonce);
    const send = vi.fn(async (nonce: number) => {
      if (nonce === 3) throw new ApiError(INVALID_NONCE_CODE);
      return { value: nonce, consumed: true };
    });
    expect(await queue.run(send)).toBe(9);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("refetches after an unknown outcome instead of guessing", async () => {
    const fetchNonce = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const queue = new NonceQueue(fetchNonce);
    await expect(queue.run(async () => Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow();
    expect(await queue.run(async (nonce) => ({ value: nonce, consumed: true }))).toBe(2);
  });

  it("does not retry invalid nonce twice", async () => {
    const queue = new NonceQueue(async () => 1);
    const send = vi.fn(async () => Promise.reject(new ApiError(INVALID_NONCE_CODE)));
    await expect(queue.run(send)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
