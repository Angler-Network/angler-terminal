"use client";

import { Check, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useTrading } from "./trading-provider";
import { useWallet } from "./wallet-provider";

interface WalletModalContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const WalletModalContext = createContext<WalletModalContextValue | null>(null);

export function useWalletModal() {
  const context = useContext(WalletModalContext);
  if (!context) throw new Error("useWalletModal must be used within WalletModalProvider");
  return context;
}

export function WalletModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return (
    <WalletModalContext.Provider value={value}>
      {children}
      <WalletModal />
    </WalletModalContext.Provider>
  );
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function WalletRow({
  name,
  icon,
  connected,
  address,
  onConnect,
  onDisconnect,
}: {
  name: string;
  icon?: string;
  connected: boolean;
  address?: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-app-hairline px-3 py-2.5">
      {icon ? <img src={icon} alt="" className="size-6 rounded-md" /> : <span className="size-6 rounded-md bg-app-chip" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-app-ink">{name}</span>
        {connected && address && <span className="block font-mono text-[11px] text-app-muted">{shortAddress(address)}</span>}
      </span>
      {connected ? (
        <span className="flex items-center gap-2">
          <Check className="size-4 text-app-up" aria-label="Connected" />
          <button type="button" onClick={onDisconnect} className="text-[12px] font-semibold text-app-muted hover:text-app-ink">
            Disconnect
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          className="h-8 rounded-lg bg-app-accent px-3 text-[12px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85"
        >
          Connect
        </button>
      )}
    </div>
  );
}

function Group({ title, badge, children }: { title: string; badge: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-app-muted">{title}</h3>
        <span className="rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">{badge}</span>
      </header>
      {children}
    </section>
  );
}

/** One place to connect both chains: EVM for Hyperliquid perps, Solana for Jupiter spot. */
function WalletModal() {
  const { isOpen, close } = useWalletModal();
  const toast = useToast();
  const evm = useWallet();
  const solana = useSolanaWallet();
  const { network } = useTrading();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;
  const fail = (error: unknown) =>
    toast({ tone: "error", title: "Couldn't connect", message: error instanceof Error ? error.message : String(error) });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu flex w-full max-w-md flex-col gap-4 rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="wallet-modal-title" className="text-[16px] font-semibold text-app-ink">
              Connect wallets
            </h2>
            <p className="mt-1 text-[12px] text-app-muted">Connect one or both. Each venue uses its own chain.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>

        <Group title="Hyperliquid perps" badge={network === "testnet" ? "EVM · Testnet" : "EVM"}>
          {evm.wallets.length === 0 ? (
            <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-app-ink underline">
              Install an EVM wallet (MetaMask, Rabby)
            </a>
          ) : (
            evm.wallets.map((entry) => (
              <WalletRow
                key={entry.id}
                name={entry.name}
                icon={entry.icon}
                connected={evm.wallet?.id === entry.id && Boolean(evm.address)}
                address={evm.address}
                onConnect={() => void evm.connect(entry).catch(fail)}
                onDisconnect={evm.disconnect}
              />
            ))
          )}
        </Group>

        <Group title="Jupiter spot" badge="Solana">
          {solana.wallets.length === 0 ? (
            <a href="https://phantom.com/download" target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-app-ink underline">
              Install a Solana wallet (Phantom, Solflare)
            </a>
          ) : (
            solana.wallets.map((entry) => (
              <WalletRow
                key={entry.name}
                name={entry.name}
                icon={entry.icon}
                connected={solana.wallet?.name === entry.name && Boolean(solana.address)}
                address={solana.address}
                onConnect={() => void solana.connect(entry).catch(fail)}
                onDisconnect={() => void solana.disconnect()}
              />
            ))
          )}
        </Group>
      </div>
    </div>
  );
}
