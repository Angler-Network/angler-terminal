"use client";

import { VenueError } from "../types";
import { changeAccountTier, getAccountIndex, lighterGet, lighterPostForm, nextNonce, registeredPublicKey, sendTx, userTier } from "./api";
import type { LighterConfig } from "./config";
import { toLighterVenueError } from "./errors";
import { encryptSecret, getDeviceKey } from "./key-crypto";
import { samePublicKey } from "./key-store";
import { authToken, forgetSessionCaches, readRecord, requireSession, signAndSend, updateRecord, waitForTx } from "./session";
import { generateApiKey, signApproveIntegrator, signChangePubKey, withL1Signature } from "./signer";

/** personal_sign with the user's EVM wallet (viem walletClient.signMessage). */
export type SignL1Message = (message: string) => Promise<string>;

export interface LighterOnboarding {
  /** Null until the first deposit created the account. */
  accountIndex: number | null;
  /** A key stored in this browser that Lighter has registered at our key index. */
  keyReady: boolean;
  /** "none" when no integrator is configured. */
  integrator: "none" | "needed" | "approved";
  /** The account type ("std", "plus", "premium") once this browser holds a key to ask with; null before. */
  tier: string | null;
}

const INTEGRATOR_APPROVAL_DAYS = 365;
const KEY_WAIT_MS = 30_000;
const TIER_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function integratorState(config: LighterConfig, accountIndex: number, l1Address: string, tier: string | null): LighterOnboarding["integrator"] {
  const integrator = config.integrator;
  if (!integrator) return "none";
  const approved = readRecord(config, l1Address, accountIndex).integrator;
  if (!approved || approved.accountIndex !== integrator.accountIndex || approved.expiresAt <= Date.now()) return "needed";
  // Approved at zero on Standard, and the account has since moved to Plus or Premium: approve the fee again.
  const paidTier = tier !== null && tier !== "std";
  return paidTier && approved.maxTakerFee === 0 && integrator.maxTakerFee > 0 ? "needed" : "approved";
}

async function readTier(config: LighterConfig, l1Address: string) {
  const session = await requireSession(config, l1Address);
  return userTier(config, session.accountIndex, await authToken(session));
}

/**
 * What's left to do for this wallet on one instance. Local state is a cache: the registered public key is re-read
 * from Lighter, so a key replaced elsewhere (another app on the same index) is dropped here too.
 */
export async function getLighterOnboarding(config: LighterConfig, l1Address: string): Promise<LighterOnboarding> {
  const accountIndex = await getAccountIndex(config, l1Address, { fresh: true });
  if (accountIndex === null) return { accountIndex: null, keyReady: false, integrator: config.integrator ? "needed" : "none", tier: null };
  const record = readRecord(config, l1Address, accountIndex);
  let keyReady = false;
  if (record.key) {
    const registered = await registeredPublicKey(config, accountIndex, record.key.apiKeyIndex);
    keyReady = samePublicKey(registered, record.key.publicKey);
    if (!keyReady) {
      updateRecord(config, l1Address, accountIndex, ({ key: _dropped, ...rest }) => rest);
      forgetSessionCaches(config, accountIndex, record.key.apiKeyIndex);
    }
  }
  const tier = keyReady ? await readTier(config, l1Address).catch(() => null) : null;
  return { accountIndex, keyReady, tier, integrator: integratorState(config, accountIndex, l1Address, tier) };
}

async function waitForApiKey(config: LighterConfig, accountIndex: number, apiKeyIndex: number, publicKey: string) {
  const deadline = Date.now() + KEY_WAIT_MS;
  while (Date.now() < deadline) {
    if (samePublicKey(await registeredPublicKey(config, accountIndex, apiKeyIndex), publicKey)) return;
    await sleep(1000);
  }
  throw new VenueError(`${config.name} accepted the key but hasn't registered it yet. Check again in a moment.`);
}

/**
 * Registers a fresh API key, generated in this browser, at the terminal's key index: the user's wallet signs the
 * ChangePubKey message once (personal_sign). Registering replaces any key at that index. With `keep: false` the new
 * key is thrown away right after, which revokes the previous one.
 */
async function registerKey(config: LighterConfig, signMessage: SignL1Message, l1Address: string, keep: boolean) {
  const accountIndex = await getAccountIndex(config, l1Address, { fresh: true });
  if (accountIndex === null) throw new VenueError(`This wallet has no ${config.name} account yet. Deposit ${config.collateral} first.`);
  const apiKeyIndex = config.apiKeyIndex;
  try {
    const { privateKey, publicKey } = await generateApiKey();
    const signer = { privateKey, chainId: config.chainId, apiKeyIndex, accountIndex };
    const tx = await signChangePubKey(signer, publicKey, await nextNonce(config, accountIndex, apiKeyIndex));
    if (!tx.messageToSign) throw new VenueError("The Lighter signer returned no message to sign.");
    const signature = await signMessage(tx.messageToSign);
    await sendTx(config, withL1Signature(tx, signature));
    forgetSessionCaches(config, accountIndex, apiKeyIndex);
    await waitForApiKey(config, accountIndex, apiKeyIndex, publicKey);
    if (!keep) {
      updateRecord(config, l1Address, accountIndex, ({ key: _dropped, ...rest }) => rest);
      return accountIndex;
    }
    const secret = await encryptSecret(await getDeviceKey(), privateKey);
    updateRecord(config, l1Address, accountIndex, (record) => ({ ...record, key: { apiKeyIndex, publicKey, secret, createdAt: Date.now() } }));
    return accountIndex;
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

export function registerLighterKey(config: LighterConfig, signMessage: SignL1Message, l1Address: string) {
  return registerKey(config, signMessage, l1Address, true);
}

/** Lighter has no "delete key": registering a throwaway key at the same index invalidates the stored one. */
export async function revokeLighterKey(config: LighterConfig, signMessage: SignL1Message, l1Address: string) {
  await registerKey(config, signMessage, l1Address, false);
}

/** Drops the local key without an on-chain call. */
export async function forgetLighterKey(config: LighterConfig, l1Address: string) {
  const accountIndex = await getAccountIndex(config, l1Address);
  if (accountIndex === null) return;
  updateRecord(config, l1Address, accountIndex, ({ key: _dropped, ...rest }) => rest);
  forgetSessionCaches(config, accountIndex, config.apiKeyIndex);
}

async function ownerOf(config: LighterConfig, accountIndex: number) {
  const body = await lighterGet(config, "account", { by: "index", value: accountIndex });
  const accounts = Array.isArray(body.accounts) ? (body.accounts as Array<{ l1_address?: string }>) : [];
  return accounts[0]?.l1_address?.toLowerCase() ?? "";
}

/**
 * Approves the instance's integrator for partner attribution. Non-zero fees only work on Plus/Premium accounts,
 * so Standard accounts approve zero fees (attribution only). The wallet signs only when the fee is above zero and
 * the integrator account has another owner.
 */
export async function approveLighterIntegrator(config: LighterConfig, signMessage: SignL1Message, l1Address: string) {
  const integrator = config.integrator;
  if (!integrator) return;
  try {
    const session = await requireSession(config, l1Address);
    const tier = await userTier(config, session.accountIndex, await authToken(session));
    const maxTakerFee = tier === "std" ? 0 : integrator.maxTakerFee;
    const sameOwner = maxTakerFee === 0 || (await ownerOf(config, integrator.accountIndex)) === l1Address.toLowerCase();
    const expiresAt = Date.now() + INTEGRATOR_APPROVAL_DAYS * 24 * 3600 * 1000;
    const hash = await signAndSend(session, async (nonce) => {
      const tx = await signApproveIntegrator(session.signer, integrator.accountIndex, maxTakerFee, expiresAt, nonce);
      if (sameOwner) return tx;
      if (!tx.messageToSign) throw new VenueError("The Lighter signer returned no message to sign.");
      return withL1Signature(tx, await signMessage(tx.messageToSign));
    });
    await waitForTx(config, hash);
    updateRecord(config, l1Address, session.accountIndex, (record) => ({
      ...record,
      integrator: { accountIndex: integrator.accountIndex, maxTakerFee, expiresAt },
    }));
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

/**
 * Moves the account from Standard (no Lighter fee, so none of ours either) to Plus, signed with the browser key's auth
 * token: no wallet popup. Waits until Lighter reports the new tier. The caller then approves our fee again.
 */
export async function upgradeLighterTier(config: LighterConfig, l1Address: string) {
  try {
    const session = await requireSession(config, l1Address);
    const auth = await authToken(session);
    await changeAccountTier(config, session.accountIndex, "plus", auth);
    const deadline = Date.now() + TIER_WAIT_MS;
    while (Date.now() < deadline) {
      if ((await userTier(config, session.accountIndex, auth)) !== "std") return;
      await sleep(1000);
    }
    throw new VenueError(`${config.name} accepted the switch but still reports Standard. Check again in a minute.`);
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

/**
 * Sets the instance's referral code (NEXT_PUBLIC_LIGHTER_REFERRAL_CODE, or _RH_ for Robinhood) on the account with
 * the browser key's auth token: no wallet signature. Lighter replaces any code the account used before, so setup
 * only does it when the user opts in.
 */
export async function applyLighterReferral(config: LighterConfig, l1Address: string) {
  const code = config.referralCode;
  if (!code) return;
  try {
    const session = await requireSession(config, l1Address);
    await lighterPostForm(config, "referral/use", { l1_address: l1Address, referral_code: code }, await authToken(session));
    updateRecord(config, l1Address, session.accountIndex, (record) => ({ ...record, referral: code }));
  } catch (error) {
    throw toLighterVenueError(error);
  }
}
