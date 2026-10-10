"use client";

import { getAddress, type WalletClient } from "viem";
import { encryptSecret, getDeviceKey } from "../lighter/key-crypto";
import { VenueError } from "../types";
import { extendedApi } from "./api";
import { extendedConfig } from "./config";
import { registrationSignature, starkKeyFromSignature } from "./signer";
import { readExtendedRecord, writeExtendedRecord, type ExtendedOnboarding } from "./store";

/**
 * Extended setup from the connected EVM wallet (as the official SDK's `x10/signing/onboarding.py`): one EIP-712 signature
 * derives the Stark key (the same signature always gives the same key, so a wallet already on Extended gets its own
 * account back), a second registers it (`POST /auth/onboard`, idempotent: an existing account is answered as is), and a
 * `personal_sign` of "<path>@<time>" mints the account's API key. Checked end to end on testnet with a throwaway wallet.
 */

const KEY_TYPES = { AccountCreation: [{ name: "accountIndex", type: "int8" }, { name: "wallet", type: "address" }, { name: "tosAccepted", type: "bool" }] } as const;
const REGISTRATION_TYPES = {
  AccountRegistration: [
    { name: "accountIndex", type: "int8" },
    { name: "wallet", type: "address" },
    { name: "tosAccepted", type: "bool" },
    { name: "time", type: "string" },
    { name: "action", type: "string" },
    { name: "host", type: "string" },
  ],
} as const;

/** "2026-10-10T12:00:00Z": seconds, no milliseconds, as Extended signs times. */
export const extendedTime = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

export function extendedOnboarding(user: string): ExtendedOnboarding {
  const record = readExtendedRecord(user);
  return { ready: Boolean(record), accountId: record?.accountId ?? null };
}

interface OnboardAnswer {
  defaultAccount?: { id?: number; accountId?: number };
}

interface AccountInfo {
  accountId: number;
  l2Vault: string | number;
  l2Key: string;
}

export async function setupExtended(wallet: WalletClient, user: `0x${string}`, options: { referral?: boolean } = {}) {
  const address = getAddress(user);
  const domain = { name: extendedConfig.signingDomain };
  const keySignature = await wallet.signTypedData({
    account: user,
    domain,
    types: KEY_TYPES,
    primaryType: "AccountCreation",
    message: { accountIndex: 0, wallet: address, tosAccepted: true },
  });
  const keys = await starkKeyFromSignature(keySignature);
  const registration = { accountIndex: 0, wallet: address, tosAccepted: true, time: extendedTime(), action: "REGISTER", host: extendedConfig.host };
  const l1Signature = await wallet.signTypedData({ account: user, domain, types: REGISTRATION_TYPES, primaryType: "AccountRegistration", message: registration });
  const l2Signature = await registrationSignature(keys.privateKey, keys.publicKey, address);
  const onboarded = await extendedApi<OnboardAnswer>("/auth/onboard", {
    method: "POST",
    body: { l1Signature, l2Key: keys.publicKey, l2Signature, accountCreation: registration, referralCode: options.referral ? extendedConfig.referralCode : null },
  });
  const accountId = onboarded.defaultAccount?.id ?? onboarded.defaultAccount?.accountId;
  if (!accountId) throw new VenueError("Extended didn't return the account.");

  const path = "/api/v1/user/account/api-key";
  const time = extendedTime();
  const signature = await wallet.signMessage({ account: user, message: `${path}@${time}` });
  const minted = await extendedApi<{ key: string }>(path, {
    method: "POST",
    headers: { l1_signature: signature, l1_message_time: time, "x-x10-active-account": String(accountId) },
    body: { description: "Angler Terminal" },
  });
  if (!minted?.key) throw new VenueError("Extended didn't return an API key.");
  const info = await extendedApi<AccountInfo>("/api/v1/user/account/info", { apiKey: minted.key });
  if (BigInt(info.l2Key) !== BigInt(keys.publicKey)) throw new VenueError("Extended's account key doesn't match this wallet's. Set it up on Extended once, then try again.");
  const device = await getDeviceKey();
  writeExtendedRecord(user, {
    accountId: info.accountId,
    vault: String(info.l2Vault),
    publicKey: keys.publicKey,
    starkKey: await encryptSecret(device, keys.privateKey),
    apiKey: await encryptSecret(device, minted.key),
  });
}
