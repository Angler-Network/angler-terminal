"use client";

import { LogOut, Wallet } from "lucide-react";
import { useWallet } from "./wallet-provider";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ConnectButton() {
  const { address, connect, disconnect, isConnecting, hasProvider } = useWallet();

  if (address) {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-app-hairline-strong bg-app-card/60 px-3 text-[13px] font-medium tabular-nums text-app-ink">
          <span aria-hidden className="size-1.5 rounded-full bg-app-up" />
          {shortAddress(address)}
        </span>
        <button
          type="button"
          onClick={disconnect}
          title="Disconnect"
          aria-label="Disconnect wallet"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-app-hairline-strong bg-app-card/60 text-app-muted hover:text-app-ink"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void connect().catch(() => {})}
      disabled={isConnecting}
      title={hasProvider ? "Connect a browser wallet" : "Install a browser wallet such as MetaMask or Rabby"}
      className="inline-flex h-9 items-center gap-2 rounded-xl bg-app-accent px-4 text-[14px] font-medium text-app-on-accent transition-colors hover:bg-app-accent/85 disabled:opacity-60"
    >
      <Wallet className="size-4" aria-hidden />
      {isConnecting ? "Connecting…" : "Connect"}
    </button>
  );
}
