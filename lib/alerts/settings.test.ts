import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS, isDiscordWebhook, normalizeCoin, parseStoredSettings, readAlertSettings } from "./settings";

const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABC-123";

describe("readAlertSettings", () => {
  it("accepts valid settings and keeps the stored Telegram chat", () => {
    const result = readAlertSettings(
      { ...DEFAULT_ALERT_SETTINGS, discordWebhook: HOOK, telegramChatId: "999", newsCoins: ["eth", "xyz:nvda", "ETH"], prices: [{ id: "p1", coin: "btc", direction: "above", price: "70000" }] },
      { ...DEFAULT_ALERT_SETTINGS, telegramChatId: "42" },
    );
    expect(result.ok && result.settings).toMatchObject({
      discordWebhook: HOOK,
      telegramChatId: "42",
      newsCoins: ["ETH", "xyz:NVDA"],
      prices: [{ id: "p1", coin: "BTC", direction: "above", price: 70_000 }],
    });
  });

  it("refuses webhooks off Discord and bad values", () => {
    expect(readAlertSettings({ ...DEFAULT_ALERT_SETTINGS, discordWebhook: "https://evil.example/api/webhooks/1/x" }).ok).toBe(false);
    expect(readAlertSettings({ ...DEFAULT_ALERT_SETTINGS, liquidationPct: 3 }).ok).toBe(false);
    expect(readAlertSettings({ ...DEFAULT_ALERT_SETTINGS, prices: [{ id: "p", coin: "BTC", direction: "above", price: 0 }] }).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("checks Discord webhook hosts", () => {
    expect(isDiscordWebhook(HOOK)).toBe(true);
    expect(isDiscordWebhook(HOOK.replace("discord.com", "discord.com.evil.io"))).toBe(false);
    expect(isDiscordWebhook(HOOK.replace("https://", "http://"))).toBe(false);
  });

  it("normalizes coins", () => {
    expect(normalizeCoin(" btc ")).toBe("BTC");
    expect(normalizeCoin("XYZ:nvda")).toBe("xyz:NVDA");
    expect(normalizeCoin("not a coin")).toBeNull();
    expect(normalizeCoin("kPEPE")).toBe("kPEPE");
    expect(normalizeCoin("kpepe")).toBe("KPEPE");
  });

  it("falls back to defaults for broken stored data", () => {
    expect(parseStoredSettings("{oops")).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(parseStoredSettings(JSON.stringify({ telegramChatId: "7", liquidationPct: 3 })).telegramChatId).toBe("7");
  });
});
