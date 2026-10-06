"use client";

import { VenueError } from "../types";
import { getAccountIndex, lighterGet, lighterPostForm, nextNonce, registeredPublicKey, sendTx, userTier } from "./api";
import { lighterConfig } from "./config";
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
}

const INTEGRATOR_APPROVAL_DAYS = 365;
const KEY_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function integratorState(accountIndex: number, l1Address: string): LighterOnboarding["integrator"] {
  const integrator = lighterConfig.integrator;
  if (!integrator) return "none";
  const approved = readRecord(l1Address, accountIndex).integrator;
  return approved && approved.accountIndex === integrator.accountIndex && approved.expiresAt > Date.now() ? "approved" : "needed";
}

/**
 * What's left to do for this wallet. Local state is a cache: the registered public key is re-read from Lighter, so
 * a key replaced elsewhere (another app on the same index) is dropped here too.
 */
export async function getLighterOnboarding(l1Address: string): Promise<LighterOnboarding> {
  const accountIndex = await getAccountIndex(l1Address, { fresh: true });
  if (accountIndex === null) return { accountIndex: null, keyReady: false, integrator: lighterConfig.integrator ? "needed" : "none" };
  const record = readRecord(l1Address, accountIndex);
  let keyReady = false;
  if (record.key) {
    const registered = await registeredPublicKey(accountIndex, record.key.apiKeyIndex);
    keyReady = samePublicKey(registered, record.key.publicKey);
    if (!keyReady) {
      updateRecord(l1Address, accountIndex, ({ key: _dropped, ...rest }) => rest);
      forgetSessionCaches(accountIndex, record.key.apiKeyIndex);
    }
  }
  return { accountIndex, keyReady, integrator: integratorState(accountIndex, l1Address) };
}

async function waitForApiKey(accountIndex: number, apiKeyIndex: number, publicKey: string) {
  const deadline = Date.now() + KEY_WAIT_MS;
  while (Date.now() < deadline) {
    if (samePublicKey(await registeredPublicKey(accountIndex, apiKeyIndex), publicKey)) return;
    await sleep(1000);
  }
  throw new VenueError("Lighter accepted the key but hasn't registered it yet. Check again in a moment.");
}

/**
 * Registers a fresh API key, generated in this browser, at the terminal's key index: the user's wallet signs the
 * ChangePubKey message once (personal_sign). Registering replaces any key at that index. With `keep: false` the new
 * key is thrown away right after, which revokes the previous one.
 */
async function registerKey(signMessage: SignL1Message, l1Address: string, keep: boolean) {
  const accountIndex = await getAccountIndex(l1Address, { fresh: true });
  if (accountIndex === null) throw new VenueError("This wallet has no Lighter account yet. Deposit USDC on Lighter first.");
  const apiKeyIndex = lighterConfig.apiKeyIndex;
  try {
    const { privateKey, publicKey } = await generateApiKey();
    const signer = { privateKey, chainId: lighterConfig.chainId, apiKeyIndex, accountIndex };
    const tx = await signChangePubKey(signer, publicKey, await nextNonce(accountIndex, apiKeyIndex));
    if (!tx.messageToSign) throw new VenueError("The Lighter signer returned no message to sign.");
    const signature = await signMessage(tx.messageToSign);
    await sendTx(withL1Signature(tx, signature));
    forgetSessionCaches(accountIndex, apiKeyIndex);
    await waitForApiKey(accountIndex, apiKeyIndex, publicKey);
    if (!keep) {
      updateRecord(l1Address, accountIndex, ({ key: _dropped, ...rest }) => rest);
      return accountIndex;
    }
    const secret = await encryptSecret(await getDeviceKey(), privateKey);
    updateRecord(l1Address, accountIndex, (record) => ({ ...record, key: { apiKeyIndex, publicKey, secret, createdAt: Date.now() } }));
    return accountIndex;
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

export function registerLighterKey(signMessage: SignL1Message, l1Address: string) {
  return registerKey(signMessage, l1Address, true);
}

/** Lighter has no "delete key": registering a throwaway key at the same index invalidates the stored one. */
export async function revokeLighterKey(signMessage: SignL1Message, l1Address: string) {
  await registerKey(signMessage, l1Address, false);
}

/** Drops the local key without an on-chain call. */
export async function forgetLighterKey(l1Address: string) {
  const accountIndex = await getAccountIndex(l1Address);
  if (accountIndex === null) return;
  updateRecord(l1Address, accountIndex, ({ key: _dropped, ...rest }) => rest);
  forgetSessionCaches(accountIndex, lighterConfig.apiKeyIndex);
}

async function ownerOf(accountIndex: number) {
  const body = await lighterGet("account", { by: "index", value: accountIndex });
  const accounts = Array.isArray(body.accounts) ? (body.accounts as Array<{ l1_address?: string }>) : [];
  return accounts[0]?.l1_address?.toLowerCase() ?? "";
}

/**
 * Approves the configured integrator for partner attribution. Non-zero fees only work on Plus/Premium accounts,
 * so Standard accounts approve zero fees (attribution only). The wallet signs only when the fee is above zero and
 * the integrator account has another owner.
 */
export async function approveLighterIntegrator(signMessage: SignL1Message, l1Address: string) {
  const integrator = lighterConfig.integrator;
  if (!integrator) return;
  try {
    const session = await requireSession(l1Address);
    const tier = await userTier(session.accountIndex, await authToken(session));
    const maxTakerFee = tier === "std" ? 0 : integrator.maxTakerFee;
    const sameOwner = maxTakerFee === 0 || (await ownerOf(integrator.accountIndex)) === l1Address.toLowerCase();
    const expiresAt = Date.now() + INTEGRATOR_APPROVAL_DAYS * 24 * 3600 * 1000;
    const hash = await signAndSend(session, async (nonce) => {
      const tx = await signApproveIntegrator(session.signer, integrator.accountIndex, maxTakerFee, expiresAt, nonce);
      if (sameOwner) return tx;
      if (!tx.messageToSign) throw new VenueError("The Lighter signer returned no message to sign.");
      return withL1Signature(tx, await signMessage(tx.messageToSign));
    });
    await waitForTx(hash);
    updateRecord(l1Address, session.accountIndex, (record) => ({
      ...record,
      integrator: { accountIndex: integrator.accountIndex, maxTakerFee, expiresAt },
    }));
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

/**
 * Sets our referral code (NEXT_PUBLIC_LIGHTER_REFERRAL_CODE) on the account with the browser key's auth token: no
 * wallet signature. Lighter replaces any code the account used before, so setup only does it when the user opts in.
 */
export async function applyLighterReferral(l1Address: string) {
  const code = lighterConfig.referralCode;
  if (!code) return;
  try {
    const session = await requireSession(l1Address);
    await lighterPostForm("referral/use", { l1_address: l1Address, referral_code: code }, await authToken(session));
    updateRecord(l1Address, session.accountIndex, (record) => ({ ...record, referral: code }));
  } catch (error) {
    throw toLighterVenueError(error);
  }
}
