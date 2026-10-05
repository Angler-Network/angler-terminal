import { describe, expect, it, vi } from "vitest";
import { fetchFavicon, normalizeDomain } from "./favicon";

describe("normalizeDomain", () => {
  it("accepts hostnames and strips www", () => {
    expect(normalizeDomain("www.Reuters.com")).toBe("reuters.com");
    expect(normalizeDomain("news.bbc.co.uk")).toBe("news.bbc.co.uk");
  });

  it("rejects paths, IPs, ports and junk", () => {
    for (const value of ["reuters.com/x", "127.0.0.1", "localhost", "a.com:8080", "", null, "-bad.com"]) {
      expect(normalizeDomain(value)).toBeNull();
    }
  });
});

describe("fetchFavicon", () => {
  const image = (type = "image/x-icon", bytes = 10) =>
    new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type } });

  it("falls back to the next source when one fails or isn't an image", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(image("image/png"));
    const icon = await fetchFavicon("reuters.com", fetchImpl as unknown as typeof fetch);
    expect(icon?.contentType).toBe("image/png");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null when nothing usable comes back", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(image("image/png", 0));
    expect(await fetchFavicon("example.com", fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});
