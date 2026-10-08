import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createSession, sessionId, SESSION_MAX_AGE_SECONDS } = await import("./session");

describe("profile sessions", () => {
  it("reads back its own tokens until they expire, and nothing forged", async () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    const id = "0x00000000000000000000000000000000000000a1";
    const token = await createSession(id, now);
    expect(await sessionId(token, now)).toBe(id);
    expect(await sessionId(token, now + SESSION_MAX_AGE_SECONDS * 1000 + 1)).toBeNull();

    const [payload, signature] = token.split(".");
    const other = Buffer.from(JSON.stringify({ id: "0x00000000000000000000000000000000000000b2", exp: now + 1e9 })).toString("base64url");
    expect(await sessionId(`${other}.${signature}`, now)).toBeNull();
    // Always a different first character, so the signature really changes.
    expect(await sessionId(`${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`, now)).toBeNull();
    expect(await sessionId(undefined, now)).toBeNull();
  });
});
