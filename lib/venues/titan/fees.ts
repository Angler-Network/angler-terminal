import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { USDC_MINT, isSolanaAddress } from "../jupiter/config";

const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MAX_FEE_BPS = 255;

/** The wallet's associated token account for a mint (classic SPL token program). */
export async function associatedTokenAddress(owner: string, mint: string): Promise<string> {
  const encoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [encoder.encode(address(owner)), encoder.encode(TOKEN_PROGRAM), encoder.encode(address(mint))],
  });
  return ata;
}

export type TitanFeeConfig = { usdcAccount: string; bps: number } | null;

/** Partner fee settings: TITAN_FEE_WALLET (receives fees in USDC) and TITAN_FEE_BPS (1-255). Null when off. */
export async function readTitanFeeConfig(env: Record<string, string | undefined>): Promise<TitanFeeConfig> {
  const wallet = env.TITAN_FEE_WALLET?.trim();
  const bps = Math.round(Number(env.TITAN_FEE_BPS));
  if (!isSolanaAddress(wallet) || !(bps > 0)) return null;
  return { usdcAccount: await associatedTokenAddress(wallet, USDC_MINT), bps: Math.min(MAX_FEE_BPS, bps) };
}

/**
 * Titan fee parameters for one swap, always taken in USDC so a single fee account (the wallet's USDC ATA) serves
 * every trade: from the input on buys (USDC → token), from the output on sells (token → USDC). No fee on swaps that
 * don't touch USDC.
 */
export function titanFeeParams(fee: TitanFeeConfig, inputMint: string, outputMint: string): Record<string, string> {
  if (!fee) return {};
  if (inputMint === USDC_MINT) return { feeAccount: fee.usdcAccount, feeBps: String(fee.bps), feeFromInputMint: "true" };
  if (outputMint === USDC_MINT) return { feeAccount: fee.usdcAccount, feeBps: String(fee.bps) };
  return {};
}
