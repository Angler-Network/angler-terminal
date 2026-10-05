import { describe, expect, it } from "vitest";
import { APPEARANCE_VERSION, parsePreferences } from "./preferences";

describe("appearance defaults", () => {
  it("defaults to the OLED theme with the Liquid surface", () => {
    expect(parsePreferences(null)).toMatchObject({ theme: "oled", surfaceStyle: "liquid" });
  });

  it("moves older saved looks to the new default once, keeping other preferences", () => {
    const old = parsePreferences(JSON.stringify({ theme: "deepnavy", surfaceStyle: "solid", oneClickTrading: true }));
    expect(old).toMatchObject({ theme: "oled", surfaceStyle: "liquid", oneClickTrading: true, appearanceVersion: APPEARANCE_VERSION });
  });

  it("keeps a look chosen after the change", () => {
    const current = parsePreferences(JSON.stringify({ theme: "midnight", surfaceStyle: "glass", appearanceVersion: APPEARANCE_VERSION }));
    expect(current).toMatchObject({ theme: "midnight", surfaceStyle: "glass" });
  });
});
