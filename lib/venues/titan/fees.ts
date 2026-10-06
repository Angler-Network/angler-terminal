import { PublicKey } from "@solana/web3.js";
import { USDC_MINT, isSolanaAddress } from "../jupiter/config";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MAX_FEE_BPS = 255;

/** The wallet's associated token account for a mint (classic SPL token program). */
export function associatedTokenAddress(owner: string, mint: string) {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0].toBase58();
}

/** Partner fee settings: TITAN_FEE_WALLET (receives fees in USDC) and TITAN_FEE_BPS (1-255). Null when off. */
export function readTitanFeeConfig(env: Record<string, string | undefined>) {
  const wallet = env.TITAN_FEE_WALLET?.trim();
  const bps = Math.round(Number(env.TITAN_FEE_BPS));
  if (!isSolanaAddress(wallet) || !(bps > 0)) return null;
  return { usdcAccount: associatedTokenAddress(wallet, USDC_MINT), bps: Math.min(MAX_FEE_BPS, bps) };
}

/**
 * Titan fee parameters for one swap, always taken in USDC so a single fee account (the wallet's USDC ATA) serves
 * every trade: from the input on buys (USDC → token), from the output on sells (token → USDC). No fee on swaps that
 * don't touch USDC.
 */
export function titanFeeParams(fee: ReturnType<typeof readTitanFeeConfig>, inputMint: string, outputMint: string): Record<string, string> {
  if (!fee) return {};
  if (inputMint === USDC_MINT) return { feeAccount: fee.usdcAccount, feeBps: String(fee.bps), feeFromInputMint: "true" };
  if (outputMint === USDC_MINT) return { feeAccount: fee.usdcAccount, feeBps: String(fee.bps) };
  return {};
}
