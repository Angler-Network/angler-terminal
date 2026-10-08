import { describe, expect, it } from "vitest";
import { createRateLimiter, rateLimited, requestIp } from "./rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit per window and resets after a minute", () => {
    let time = 0;
    const allow = createRateLimiter(() => time);
    expect([1, 2, 3].map(() => allow("a", 2))).toEqual([true, true, false]);
    expect(allow("b", 2)).toBe(true);
    time = 59_999;
    expect(allow("a", 2)).toBe(false);
    time = 60_000;
    expect(allow("a", 2)).toBe(true);
  });

  it("reads the caller's IP from Vercel's headers", () => {
    expect(requestIp({ headers: new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }) })).toBe("1.2.3.4");
    expect(requestIp({ headers: new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }) })).toBe("5.6.7.8");
    expect(requestIp({ headers: new Headers() })).toBe("unknown");
  });

  it("answers 429 once an IP is over the route's limit", () => {
    const request = { headers: new Headers({ "x-real-ip": "203.0.113.7" }) };
    for (let index = 0; index < 30; index++) expect(rateLimited(request, "test-send", "send")).toBeNull();
    expect(rateLimited(request, "test-send", "send")?.status).toBe(429);
    // Another route keeps its own count.
    expect(rateLimited(request, "test-other", "send")).toBeNull();
  });
});
