"use client";

import { Check, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useWallet, type EvmWallet } from "./wallet-provider";
import { useModalEnter } from "@/components/app/use-motion";
import type { Wallet as SolanaWallet } from "@wallet-standard/base";

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
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

/** EVM and Solana entries of the same wallet app (Phantom, Backpack…) share a row: one press connects both. */
interface WalletRow {
  key: string;
  name: string;
  icon?: string;
  evm?: EvmWallet;
  solana?: SolanaWallet;
}

const rowKey = (name: string) => name.toLowerCase().replace(/\s*wallet$/, "").replace(/[^a-z0-9]/g, "");

function mergeWallets(evm: EvmWallet[], solana: SolanaWallet[]): WalletRow[] {
  const rows = new Map<string, WalletRow>();
  for (const wallet of evm) {
    const key = rowKey(wallet.name);
    rows.set(key, { ...(rows.get(key) ?? { key, name: wallet.name, icon: wallet.icon }), evm: wallet });
  }
  for (const wallet of solana) {
    const key = rowKey(wallet.name);
    const row = rows.get(key);
    rows.set(key, row ? { ...row, solana: wallet, icon: row.icon ?? wallet.icon } : { key, name: wallet.name, icon: wallet.icon, solana: wallet });
  }
  // Wallets that cover both chains first: they connect everything in one press.
  return [...rows.values()].sort((a, b) => Number(Boolean(b.evm && b.solana)) - Number(Boolean(a.evm && a.solana)));
}

function WalletIcon({ icon, name, className }: { icon?: string; name: string; className: string }) {
  return icon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={icon} alt="" className={className} />
  ) : (
    <span className={`flex items-center justify-center bg-app-chip text-[12px] font-bold text-app-ink ${className}`}>{name.charAt(0)}</span>
  );
}

const INSTALL: Array<{ name: string; url: string; icon: string }> = [
  { name: "Phantom", url: "https://phantom.com/download", icon: "phantom.com" },
  { name: "Rabby", url: "https://rabby.io", icon: "rabby.io" },
  { name: "MetaMask", url: "https://metamask.io/download/", icon: "metamask.io" },
];

/** Chain marks scattered behind the card, faint and still. */
const BACKDROP: Array<{ src: string; className: string }> = [
  { src: "/chains/solana.svg", className: "-left-6 top-10 size-24 -rotate-12" },
  { src: "/chains/ethereum.svg", className: "-right-5 top-6 size-20 rotate-12" },
  { src: "/chains/hyperliquid.svg", className: "-bottom-6 left-16 size-16 rotate-6" },
  { src: "/tokens/usdc.png", className: "-bottom-4 right-14 size-20 -rotate-6" },
];

const tileClass = "flex w-[92px] flex-col items-center gap-2 rounded-2xl border px-2 py-3 transition-colors";

/**
 * "Connect Wallet": every detected wallet as a tile, merged across chains so Phantom & co. connect EVM and Solana in
 * one press. Connected wallets show a check and disconnect from the line under the tiles.
 */
function WalletModal() {
  const { isOpen, close } = useWalletModal();
  const toast = useToast();
  const evm = useWallet();
  const solana = useSolanaWallet();
  const [pending, setPending] = useState<string | null>(null);
  const rows = useMemo(() => mergeWallets(evm.wallets, solana.wallets), [evm.wallets, solana.wallets]);
  const backdropRef = useModalEnter(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const fills = (row: WalletRow) => (row.evm && !evm.address) || (row.solana && !solana.address);
  const connectedHere = (row: WalletRow) =>
    Boolean(row.evm && evm.address && evm.wallet?.id === row.evm.id) || Boolean(row.solana && solana.address && solana.wallet?.name === row.solana.name);

  const connect = async (row: WalletRow) => {
    if (pending || !fills(row)) return;
    setPending(row.key);
    try {
      if (row.evm && !evm.address) await evm.connect(row.evm);
      if (row.solana && !solana.address) await solana.connect(row.solana);
      // Stay open only while another wallet here could still add the chain that's missing.
      const missing = (["evm", "solana"] as const).filter((chain) => (chain === "evm" ? !evm.address && !row.evm : !solana.address && !row.solana));
      const canAddMore = missing.some((chain) => rows.some((other) => other.key !== row.key && (chain === "evm" ? other.evm : other.solana)));
      if (!canAddMore) close();
    } catch (error) {
      toast({ tone: "error", title: `Couldn't connect ${row.name}`, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(null);
    }
  };

  const connected = [
    evm.address ? { chain: "EVM", address: evm.address, disconnect: () => evm.disconnect() } : null,
    solana.address ? { chain: "Solana", address: solana.address, disconnect: () => void solana.disconnect() } : null,
  ].filter((entry) => entry !== null);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]" ref={backdropRef} role="presentation" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[460px] flex-col overflow-hidden rounded-[24px] border border-app-hairline-strong bg-app-dialog shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]"
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {BACKDROP.map((item) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={item.src} src={item.src} alt="" className={`absolute opacity-[0.07] grayscale ${item.className}`} />
          ))}
        </div>

        <button type="button" onClick={close} aria-label="Close" className="absolute right-4 top-4 z-10 rounded-lg p-1 text-app-faint hover:text-app-ink">
          <X className="size-4" />
        </button>

        <div className="relative flex flex-col gap-6 overflow-y-auto px-6 pb-6 pt-9">
          <h2 id="wallet-modal-title" className="text-center text-[22px] font-semibold tracking-[-0.02em] text-app-ink">
            Connect Wallet
          </h2>

          <div className="rounded-[18px] border border-app-hairline-strong bg-app-dialog/70 px-4 py-6 backdrop-blur-sm">
            <div className="flex flex-wrap justify-center gap-3">
              {rows.length === 0
                ? INSTALL.map((entry) => (
                    <a key={entry.name} href={entry.url} target="_blank" rel="noopener noreferrer" className={`${tileClass} border-app-hairline hover:border-app-hairline-strong hover:bg-app-chip/60`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/favicon?domain=${entry.icon}`} alt="" className="size-11 rounded-xl" />
                      <span className="text-[12px] font-semibold text-app-ink">{entry.name}</span>
                      <span className="text-[10px] text-app-faint">Install ↗</span>
                    </a>
                  ))
                : rows.map((row) => {
                    const isConnected = connectedHere(row);
                    const disabled = pending !== null || !fills(row);
                    return (
                      <button
                        key={row.key}
                        type="button"
                        disabled={disabled}
                        onClick={() => void connect(row)}
                        title={!isConnected && !fills(row) ? "Disconnect the current wallet first to switch" : undefined}
                        className={`${tileClass} disabled:cursor-default ${
                          isConnected
                            ? "border-app-up/50 bg-app-up/[0.06]"
                            : disabled
                              ? "border-app-hairline opacity-45"
                              : "border-app-hairline hover:-translate-y-0.5 hover:border-app-hairline-strong hover:bg-app-chip/60"
                        }`}
                      >
                        <span className="relative">
                          <WalletIcon icon={row.icon} name={row.name} className="size-11 rounded-xl" />
                          {pending === row.key && (
                            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
                              <Loader2 className="size-4 animate-spin text-white" aria-label="Connecting" />
                            </span>
                          )}
                          {isConnected && (
                            <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-app-up text-app-dialog">
                              <Check className="size-3" strokeWidth={3} />
                            </span>
                          )}
                        </span>
                        <span className="w-full truncate text-center text-[12px] font-semibold text-app-ink">{row.name}</span>
                      </button>
                    );
                  })}
            </div>
          </div>

          {connected.length > 0 && (
            <ul className="flex flex-col gap-1 text-[12px]">
              {connected.map((entry) => (
                <li key={entry.chain} className="flex items-center gap-2 text-app-muted">
                  <span className="size-1.5 rounded-full bg-app-up" />
                  <span className="w-12 text-app-faint">{entry.chain}</span>
                  <span className="flex-1 font-mono text-app-ink">{shortAddress(entry.address)}</span>
                  <button type="button" onClick={entry.disconnect} className="text-app-faint hover:text-app-down">
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-center text-[11px] text-app-faint">Your keys stay in your wallet. Angler only asks it to sign the trades you place.</p>
        </div>
      </div>
    </div>
  );
}
