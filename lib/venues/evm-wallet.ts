"use client";

import { createWalletClient, custom, type Chain, type EIP1193Provider } from "viem";

/** Moves the wallet to `chain`, adding the network first when the wallet doesn't know it. */
export async function walletOnChain(provider: EIP1193Provider, account: `0x${string}`, chain: Chain) {
  const wallet = createWalletClient({ account, chain, transport: custom(provider) });
  if ((await wallet.getChainId()) === chain.id) return wallet;
  try {
    await wallet.switchChain({ id: chain.id });
  } catch (error) {
    const code = (error as { code?: number; cause?: { code?: number } }).code ?? (error as { cause?: { code?: number } }).cause?.code;
    if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String((error as Error).message))) throw error;
    await wallet.addChain({ chain });
    if ((await wallet.getChainId()) !== chain.id) await wallet.switchChain({ id: chain.id });
  }
  return wallet;
}

/** A wallet error in one readable line. */
export function walletMessage(error: unknown) {
  const code = (error as { code?: number } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 4001 || /reject|denied|cancel/i.test(message)) return "You rejected the request in your wallet.";
  return message.split("\n")[0];
}
