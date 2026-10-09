import { address, getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { base58 } from "./base58";
import { nextClientOrderIndex } from "@/lib/venues/lighter/pricing";
import { isFresh, profileIdOf, profileMessage, readProfileMessage, usernameError } from "./identity";
import { levelFor, pointsFor } from "./levels";
import { tierFees } from "./vip";
import { hlAnglerVolume, isAnglerFill, lighterAnglerVolume, readAnglerSwap, type LighterTrade, type ParsedSolanaTx } from "./volume";

describe("levels", () => {
  it("gives 0.01 point per dollar and walks the level table", () => {
    expect(pointsFor(1234.99)).toBe(12.34);
    expect(pointsFor(-5)).toBe(0);
    expect(levelFor(0)).toMatchObject({ level: 1, name: "Minnow", next: 10, progress: 0 });
    expect(levelFor(30)).toMatchObject({ level: 2, name: "Perch", floor: 10, next: 50, nextName: "Trout", progress: 0.5 });
    expect(levelFor(2e9)).toMatchObject({ level: 10, name: "Whale", next: null, progress: 1 });
  });
});

describe("identity", () => {
  it("canonicalises addresses", () => {
    expect(profileIdOf("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01")).toEqual({ id: "0xabcdef0123456789abcdef0123456789abcdef01", chain: "evm" });
    expect(profileIdOf("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij")?.chain).toBe("solana");
    expect(profileIdOf("hello")).toBeNull();
  });

  it("checks usernames", () => {
    expect(usernameError("whale_42")).toBeNull();
    expect(usernameError("ab")).not.toBeNull();
    expect(usernameError("12345")).not.toBeNull();
    expect(usernameError("0xdead")).not.toBeNull();
    expect(usernameError("Angler")).not.toBeNull();
    expect(usernameError("bad name")).not.toBeNull();
  });

  it("round-trips signed messages and expires them", () => {
    const issuedAt = "2026-10-07T10:00:00.000Z";
    const message = profileMessage({ kind: "username", username: "whale_42" }, "0xabc", issuedAt);
    expect(readProfileMessage(message)).toEqual({ action: { kind: "username", username: "whale_42" }, address: "0xabc", issuedAt: Date.parse(issuedAt) });
    const link = profileMessage({ kind: "link", profile: "0xabc" }, "SoLaNa", issuedAt);
    expect(readProfileMessage(link)?.action).toEqual({ kind: "link", profile: "0xabc" });
    expect(readProfileMessage(message.replace("Angler Terminal", "Other app"))).toBeNull();
    expect(readProfileMessage(`${message}\nextra`)).toBeNull();
    const now = Date.parse(issuedAt);
    expect(isFresh(now, now + 5 * 60_000)).toBe(true);
    expect(isFresh(now, now + 11 * 60_000)).toBe(false);
    expect(isFresh(now + 5 * 60_000, now)).toBe(false);
  });
});

describe("Hyperliquid volume", () => {
  // Our builder fee: 25 tenths of a bp = 2.5 bps.
  const fill = (px: string, sz: string, builderFee?: string, time = 1) => ({ px, sz, builderFee, time, tid: time });

  it("counts fills that paid our builder fee only", () => {
    expect(isAnglerFill(fill("100", "10", "0.25"), 25)).toBe(true);
    expect(isAnglerFill(fill("100", "10", "0.5"), 25)).toBe(false); // another app's 5 bps
    expect(isAnglerFill(fill("100", "10"), 25)).toBe(false);
    expect(isAnglerFill(fill("100", "10", "0.25"), 0)).toBe(false);
    expect(hlAnglerVolume([fill("100", "10", "0.25", 5), fill("50", "2", undefined, 9)], 25)).toEqual({ usd: 1000, betaUsd: 0, fee: 0.25, lastTime: 9 });
    // Fills placed during the closed beta, by their own time.
    expect(hlAnglerVolume([fill("100", "10", "0.25", 5), fill("100", "5", "0.125", 9)], 25, (time) => time >= 8)).toMatchObject({ usd: 1500, betaUsd: 500 });
    // Any VIP tier of a 3.5 bps fee: VIP 2 pays 3 bps ($0.30 on $1000), and 3.5 bps still counts.
    expect(isAnglerFill(fill("100", "10", "0.3"), tierFees(35))).toBe(true);
    expect(isAnglerFill(fill("100", "10", "0.35"), tierFees(35))).toBe(true);
    expect(isAnglerFill(fill("100", "10", "0.1"), tierFees(35))).toBe(false);
  });
});

describe("Lighter volume", () => {
  const ours = nextClientOrderIndex(Date.parse("2026-10-07T10:00:00Z"), 0);
  const trade = (patch: Partial<LighterTrade>): LighterTrade => ({
    trade_id: 1,
    usd_amount: "500.5",
    timestamp: 10,
    ask_account_id: 7,
    bid_account_id: 8,
    ask_client_id: 179136952744026,
    bid_client_id: 0,
    ...patch,
  });

  it("counts trades whose own side carries the terminal tag", () => {
    // No fee fields: a Standard account, so the whole trade is Standard volume.
    expect(lighterAnglerVolume([trade({ ask_client_id: ours })], 7)).toEqual({ usd: 500.5, standardUsd: 500.5, betaUsd: 0, betaStandardUsd: 0, lastTime: 10 });
    // The tag on the other side's order doesn't count for this account.
    expect(lighterAnglerVolume([trade({ bid_client_id: ours })], 7).usd).toBe(0);
    expect(lighterAnglerVolume([trade({ bid_client_id: ours, timestamp: 12 })], 8)).toMatchObject({ usd: 500.5, standardUsd: 500.5, lastTime: 12 });
    const paid = trade({ ask_client_id: ours, is_maker_ask: false, taker_fee: 280, timestamp: 20 });
    expect(lighterAnglerVolume([trade({ ask_client_id: ours }), paid], 7, (time) => time >= 10)).toMatchObject({ usd: 1001, betaUsd: 1001, betaStandardUsd: 500.5 });
    expect(lighterAnglerVolume([trade({ ask_client_id: ours }), paid], 7, (time) => time >= 15)).toMatchObject({ betaUsd: 500.5, betaStandardUsd: 0 });
  });

  it("tells Plus and Premium trades (own side paid a fee) from Standard ones", () => {
    // Account 7 is the ask; the ask rested (maker), so its fee is maker_fee.
    const paidMaker = trade({ ask_client_id: ours, is_maker_ask: true, maker_fee: 50, taker_fee: 0 });
    expect(lighterAnglerVolume([paidMaker], 7)).toMatchObject({ usd: 500.5, standardUsd: 0 });
    // Same trade, but the taker (bid, account 8) paid nothing: Standard for account 8.
    const freeTaker = trade({ bid_client_id: ours, is_maker_ask: true, maker_fee: 50, taker_fee: 0 });
    expect(lighterAnglerVolume([freeTaker], 8)).toMatchObject({ usd: 500.5, standardUsd: 500.5 });
    const paidTaker = trade({ bid_client_id: ours, is_maker_ask: true, taker_fee: 280 });
    expect(lighterAnglerVolume([paidTaker, freeTaker], 8)).toMatchObject({ usd: 1001, standardUsd: 500.5 });
  });
});

describe("Solana swaps", () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const balance = (accountIndex: number, owner: string, mint: string, amount: string) => ({ accountIndex, owner, mint, uiTokenAmount: { amount, decimals: 6 } });
  const tx = (keys: string[], pre: ReturnType<typeof balance>[], post: ReturnType<typeof balance>[], err: unknown = null): ParsedSolanaTx => ({
    meta: { err, preTokenBalances: pre, postTokenBalances: post },
    transaction: { message: { accountKeys: keys.map((pubkey, index) => ({ pubkey, signer: index === 0 })) } },
  });
  const proof = { feeAccounts: new Set(["ReferralAta"]), feeOwners: new Set(["FeeWallet"]) };

  it("reads the signer's USDC change on swaps that paid us", () => {
    // Jupiter: our referral token account is in the transaction.
    const jupiter = tx(["User", "ReferralAta", "Pool"], [balance(3, "User", USDC, "250000000")], [balance(3, "User", USDC, "150000000")]);
    expect(readAnglerSwap(jupiter, proof, USDC)).toEqual({ signer: "User", usd: 100 });
    // Titan: the fee wallet's USDC balance grows.
    const titan = tx(["User", "Pool"], [balance(1, "FeeWallet", USDC, "0"), balance(2, "User", USDC, "0")], [balance(1, "FeeWallet", USDC, "30000"), balance(2, "User", USDC, "120000000")]);
    expect(readAnglerSwap(titan, proof, USDC)).toEqual({ signer: "User", usd: 120 });
  });

  it("refuses swaps that didn't pay us or failed", () => {
    expect(readAnglerSwap(tx(["User", "Pool"], [balance(2, "User", USDC, "5")], [balance(2, "User", USDC, "1")]), proof, USDC)).toBeNull();
    expect(readAnglerSwap(tx(["User", "ReferralAta"], [balance(2, "User", USDC, "5")], [balance(2, "User", USDC, "1")], { InstructionError: [] }), proof, USDC)).toBeNull();
  });
});

describe("base58", () => {
  it("matches the Solana encoding", () => {
    expect(base58(new Uint8Array([0, 0, 1]))).toBe("112");
    expect(base58(new TextEncoder().encode("hello world"))).toBe("StV1DL6CwTryKyV");
    // The USDC mint's 32 bytes round-trip to its address.
    expect(base58(getAddressEncoder().encode(address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")) as Uint8Array)).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });
});

describe("referral messages", () => {
  it("round-trips the referral action", async () => {
    const { profileMessage, readProfileMessage, REFERRAL_CODE } = await import("./identity");
    const message = profileMessage({ kind: "referral", code: "magefx" }, "0xabc", "2026-10-07T12:00:00.000Z");
    expect(readProfileMessage(message)?.action).toEqual({ kind: "referral", code: "magefx" });
    expect(REFERRAL_CODE.test("0x454afa0a5a59e7ca968d28831298c0a2530862dc")).toBe(true);
    expect(REFERRAL_CODE.test("bad code!")).toBe(false);
  });
});
