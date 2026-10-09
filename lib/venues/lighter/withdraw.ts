import type { EIP1193Provider } from "viem";
import { VenueError } from "../types";
import { lighterGet, lighterPostForm } from "./api";
import type { LighterConfig, LighterVenueId } from "./config";
import { toLighterVenueError } from "./errors";
import { authToken, nonceQueue, requireSession } from "./session";
import { ROUTE, signTransfer, withL1Signature } from "./signer";

/**
 * Lighter's fast withdrawal (docs: "Deposits, Transfers and Withdrawals"): a transfer to Lighter's fast-withdraw pool
 * account with the payout address in the memo, signed by the trading key and by the wallet (L1 signature), sent to
 * `POST /fastwithdraw`. Core Lighter pays USDC on Arbitrum (minimum 4); Lighter RH pays USDG, presumably on Robinhood
 * Chain (minimum 1; check the first real one). The transfer fee is charged on top of the amount. The secure withdrawal
 * settles on Ethereum and takes hours, so it isn't offered. Reference: lighter-python `examples/transfers/withdraw_fast.py`.
 */

/** The least a fast withdrawal takes, per instance (Lighter's docs). */
export const FAST_WITHDRAW_MIN: Record<LighterVenueId, number> = { lighter: 4, lighterRh: 1 };

/** The memo: the 20-byte payout address then 12 zero bytes, as hex. */
export function fastWithdrawMemo(address: string) {
  const hex = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new VenueError("Invalid withdrawal address.");
  return hex + "0".repeat(24);
}

const MARGIN_SYMBOL: Record<LighterVenueId, string> = { lighter: "USDC", lighterRh: "USDG" };

/** Withdraws `units` (6 decimals) of the margin dollar to `address`, the wallet that owns the account. */
export async function fastWithdrawLighter(venue: LighterVenueId, config: LighterConfig, provider: EIP1193Provider, address: `0x${string}`, units: bigint) {
  try {
    const session = await requireSession(config, address);
    const auth = await authToken(session);
    const info = await lighterGet(config, "fastwithdraw/info", { account_index: session.accountIndex }, auth);
    const pool = Number(info.to_account_index);
    if (!Number.isInteger(pool) || pool < 0) throw new VenueError(`${config.name} returned no fast-withdraw pool.`);
    const amount = Number(units) / 1e6;
    const limit = Number(info.withdraw_limit);
    if (Number.isFinite(limit) && limit > 0 && amount > limit) throw new VenueError(`${config.name}'s fast withdrawals take at most ${limit.toFixed(2)} right now.`);
    if (amount < FAST_WITHDRAW_MIN[venue]) throw new VenueError(`The minimum is ${FAST_WITHDRAW_MIN[venue]} ${MARGIN_SYMBOL[venue]}.`);
    const fee = Number((await lighterGet(config, "transferFeeInfo", { account_index: session.accountIndex, to_account_index: pool }, auth)).transfer_fee_usdc) || 0;
    const assets = (await lighterGet(config, "assetDetails")).asset_details;
    const asset = Array.isArray(assets) ? (assets as Array<{ asset_id?: unknown; symbol?: unknown }>).find((entry) => entry.symbol === MARGIN_SYMBOL[venue]) : null;
    const assetIndex = Number(asset?.asset_id);
    if (!Number.isInteger(assetIndex)) throw new VenueError(`${config.name} lists no ${MARGIN_SYMBOL[venue]} asset.`);

    const [{ createWalletClient, custom }] = await Promise.all([import("viem")]);
    const wallet = createWalletClient({ account: address, transport: custom(provider) });
    await nonceQueue(config, session.accountIndex, session.signer.apiKeyIndex).run(async (nonce) => {
      const tx = await signTransfer(
        session.signer,
        { toAccountIndex: pool, assetIndex, fromRoute: ROUTE.perps, toRoute: ROUTE.perps, amount: Number(units), usdcFee: fee, memo: fastWithdrawMemo(address) },
        nonce,
      );
      if (!tx.messageToSign) throw new VenueError("The Lighter signer returned no message to sign.");
      const signed = withL1Signature(tx, await wallet.signMessage({ account: address, message: tx.messageToSign }));
      await lighterPostForm(config, "fastwithdraw", { tx_info: signed.txInfo, to_address: address }, auth);
      return { value: undefined, consumed: true };
    });
  } catch (error) {
    throw toLighterVenueError(error);
  }
}
