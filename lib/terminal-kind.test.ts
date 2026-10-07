import { describe, expect, it } from "vitest";
import { terminalKindOf } from "./terminal-kind";

describe("terminalKindOf", () => {
  it("reads the view from the path", () => {
    expect(terminalKindOf("/perp")).toBe("perp");
    expect(terminalKindOf("/swap")).toBe("spot");
    expect(terminalKindOf("/swap/")).toBe("spot");
  });

  it("is null outside the terminal", () => {
    expect(terminalKindOf("/")).toBeNull();
    expect(terminalKindOf("/markets")).toBeNull();
    expect(terminalKindOf("/prediction")).toBeNull();
    expect(terminalKindOf("/perpetual")).toBeNull();
    // The old path redirects (next.config.mjs) before it reaches the shell.
    expect(terminalKindOf("/spot")).toBeNull();
    expect(terminalKindOf(null)).toBeNull();
  });
});
