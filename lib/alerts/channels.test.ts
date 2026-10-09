import { describe, expect, it } from "vitest";
import { readBotUsername } from "./channels";

describe("readBotUsername", () => {
  it("reads the username however it was entered", () => {
    expect(readBotUsername("angleralertsbot")).toBe("angleralertsbot");
    expect(readBotUsername(" @angleralertsbot ")).toBe("angleralertsbot");
    expect(readBotUsername("https://t.me/angleralertsbot")).toBe("angleralertsbot");
    expect(readBotUsername("t.me/angleralertsbot?start=x")).toBe("angleralertsbot");
  });

  it("refuses what isn't a username", () => {
    expect(readBotUsername("")).toBeNull();
    expect(readBotUsername("bad name")).toBeNull();
  });
});
