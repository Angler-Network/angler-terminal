"use client";

import { Wallet } from "lucide-react";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Opens the wallet modal; once connected, shows each connected chain's address. */
export function ConnectButton() {
  const { open } = useWalletModal();
  const { address: evmAddress } = useWallet();
  const { address: solanaAddress } = useSolanaWallet();

  if (!evmAddress && !solanaAddress) {
    return (
      <button
        type="button"
        onClick={open}
        className="inline-flex h-8 items-center gap-2 rounded-lg bg-app-accent px-3.5 text-[13px] font-medium text-app-on-accent transition-colors hover:bg-app-accent/85"
      >
        <Wallet className="size-4" aria-hidden />
        Connect
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Manage wallets"
      className="inline-flex h-8 items-center gap-2 rounded-lg border border-app-hairline-strong bg-app-card/60 px-3 text-[12px] font-medium tabular-nums text-app-ink hover:bg-app-card"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-app-up" />
      {evmAddress && <span title="EVM wallet (Hyperliquid, Lighter)">{short(evmAddress)}</span>}
      {evmAddress && solanaAddress && <span className="text-app-faint">·</span>}
      {solanaAddress && <span title="Jupiter (Solana)">{short(solanaAddress)}</span>}
    </button>
  );
}
