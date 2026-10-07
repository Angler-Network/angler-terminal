"use client";

import { venueAvailable, type VenueKey } from "@/lib/deployment";
import { Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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

type Chain = "evm" | "solana";
const CHAINS: Chain[] = ["evm", "solana"];

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

/** The venues each chain's wallet unlocks, printed under its port. */
const VENUES: Record<Chain, Array<{ id: VenueKey; name: string }>> = {
  evm: [
    { id: "hyperliquid", name: "Hyperliquid" },
    { id: "lighter", name: "Lighter" },
    { id: "lighterRh", name: "Lighter RH" },
    { id: "arcus", name: "Arcus" },
  ],
  solana: [
    { id: "jupiter", name: "Jupiter" },
    { id: "titan", name: "Titan" },
  ],
};

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

/**
 * A chain's port: an empty socket until a wallet plugs in. Hovering a wallet below slides its icon into every port
 * it would fill, so the user sees what one press connects before pressing.
 */
function Port({
  chain,
  address,
  plugged,
  preview,
  onUnplug,
}: {
  chain: Chain;
  address: string | null;
  plugged?: { name: string; icon?: string };
  preview?: { name: string; icon?: string };
  onUnplug: () => void;
}) {
  const venues = VENUES[chain].filter((venue) => venueAvailable(venue.id));
  const state = address ? "on" : preview ? "preview" : "off";
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 rounded-[14px] border p-3 transition-colors duration-200 ${
        state === "on" ? "border-app-up/45" : state === "preview" ? "border-app-accent/60" : "border-app-hairline"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.14em]">
        <span className="font-semibold text-app-ink">{chain === "evm" ? "EVM" : "Solana"}</span>
        <span className={state === "on" ? "text-app-up" : state === "preview" ? "text-app-accent" : "text-app-faint"}>
          {state === "on" ? "● live" : state === "preview" ? "○ ready" : "○ empty"}
        </span>
      </div>

      {/* The socket: pin marks along an inset slot; the wallet sits in it once plugged. */}
      <div className="relative h-11 overflow-hidden rounded-[9px] border border-app-hairline-strong bg-app-chip/40 shadow-[inset_0_2px_6px_rgba(0,0,0,0.35)]">
        <div className="absolute inset-x-3 bottom-1.5 h-1 bg-[repeating-linear-gradient(90deg,rgb(var(--app-hairline-strong))_0_2px,transparent_2px_7px)] opacity-60" />
        {address && plugged ? (
          <div className="absolute inset-0 flex items-center gap-2 px-2">
            <WalletIcon icon={plugged.icon} name={plugged.name} className="size-7 shrink-0 rounded-md" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-app-ink">{shortAddress(address)}</span>
            <button
              type="button"
              onClick={onUnplug}
              className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-app-faint hover:bg-app-down/10 hover:text-app-down"
            >
              Unplug
            </button>
          </div>
        ) : (
          <div
            className={`absolute inset-0 flex items-center gap-2 px-2 transition-[opacity,transform] duration-200 ${
              preview ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
            }`}
          >
            {preview && <WalletIcon icon={preview.icon} name={preview.name} className="size-7 shrink-0 rounded-md opacity-70" />}
            <span className="truncate font-mono text-[11px] text-app-muted">{preview ? `${preview.name} fits` : ""}</span>
          </div>
        )}
      </div>

      <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.08em] text-app-faint">
        {venues.map((venue, index) => (
          <span key={venue.id} className={`whitespace-nowrap ${address ? "text-app-muted" : ""}`}>
            {index > 0 && <span className="px-1 text-app-hairline-strong">/</span>}
            {venue.name}
          </span>
        ))}
      </p>
    </div>
  );
}

const INSTALL: Array<{ name: string; url: string; chains: Chain[] }> = [
  { name: "Phantom", url: "https://phantom.com/download", chains: ["evm", "solana"] },
  { name: "Rabby", url: "https://rabby.io", chains: ["evm"] },
  { name: "MetaMask", url: "https://metamask.io/download/", chains: ["evm"] },
];

const chainLabel = (chains: Chain[]) => chains.map((chain) => (chain === "evm" ? "EVM" : "SOL")).join(" + ");

/**
 * One screen, no venue picking: two chain ports on top, every wallet the browser has below as a numbered list
 * (merged across chains; keys 1-9 connect). A press plugs the wallet into each port it fits that is still empty.
 */
function WalletModal() {
  const { isOpen, close } = useWalletModal();
  const toast = useToast();
  const evm = useWallet();
  const solana = useSolanaWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const rows = useMemo(() => mergeWallets(evm.wallets, solana.wallets), [evm.wallets, solana.wallets]);
  const backdropRef = useModalEnter(isOpen);

  const address: Record<Chain, string | null> = { evm: evm.address ?? null, solana: solana.address ?? null };
  /** The empty ports this wallet would fill. */
  const fills = (row: WalletRow) => CHAINS.filter((chain) => (chain === "evm" ? row.evm : row.solana) && !address[chain]);
  const connectedHere = (row: WalletRow) => ({
    evm: Boolean(row.evm && evm.address && evm.wallet?.id === row.evm.id),
    solana: Boolean(row.solana && solana.address && solana.wallet?.name === row.solana.name),
  });

  const connect = async (row: WalletRow) => {
    if (pending || fills(row).length === 0) return;
    setPending(row.key);
    try {
      if (row.evm && !evm.address) await evm.connect(row.evm);
      if (row.solana && !solana.address) await solana.connect(row.solana);
      // Stay open only while another wallet here could still fill the port that's missing.
      const missing = CHAINS.filter((chain) => (chain === "evm" ? !evm.address && !row.evm : !solana.address && !row.solana));
      const canAddMore = missing.some((chain) => rows.some((other) => other.key !== row.key && (chain === "evm" ? other.evm : other.solana)));
      if (!canAddMore) close();
    } catch (error) {
      toast({ tone: "error", title: `Couldn't connect ${row.name}`, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(null);
    }
  };

  // Keys read the latest rows and connect through a ref, so the listener stays put while the modal is open.
  const keyAction = useRef<(event: KeyboardEvent) => void>(() => {});
  keyAction.current = (event) => {
    if (event.key === "Escape") return close();
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && rows[index]) void connect(rows[index]);
  };
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => keyAction.current(event);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  const hoveredRow = rows.find((row) => row.key === hovered);
  const plugged: Record<Chain, { name: string; icon?: string } | undefined> = {
    evm: evm.wallet ? { name: evm.wallet.name, icon: evm.wallet.icon } : undefined,
    solana: solana.wallet ? { name: solana.wallet.name, icon: solana.wallet.icon } : undefined,
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]" ref={backdropRef} role="presentation" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle flex max-h-[calc(100dvh-2rem)] w-full max-w-[560px] flex-col overflow-y-auto rounded-[20px] border border-app-hairline-strong bg-app-dialog shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]"
      >
        <header className="flex items-center justify-between border-b border-app-hairline px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-app-faint">
          <span>
            <span className="text-app-accent">angler</span> / connect
          </span>
          <button type="button" onClick={close} aria-label="Close" className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:text-app-ink">
            <kbd className="rounded border border-app-hairline-strong px-1 text-[10px]">esc</kbd>
            <X className="size-3.5" />
          </button>
        </header>

        <div className="flex flex-col gap-5 p-5">
          <div>
            <h2 id="wallet-modal-title" className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-app-ink">
              Plug in a wallet.
            </h2>
            <p className="mt-1 text-[13px] text-app-muted">Two ports, every venue. A wallet that speaks both chains fills both in one go.</p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {CHAINS.map((chain) => (
              <Port
                key={chain}
                chain={chain}
                address={address[chain]}
                plugged={plugged[chain]}
                preview={hoveredRow && fills(hoveredRow).includes(chain) ? hoveredRow : undefined}
                onUnplug={() => (chain === "evm" ? evm.disconnect() : void solana.disconnect())}
              />
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col">
              <p className="pb-2 text-[13px] text-app-muted">No wallet in this browser yet. Install one, then reopen this:</p>
              {INSTALL.map((entry) => (
                <a
                  key={entry.name}
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 border-t border-app-hairline py-2.5 text-[14px] font-semibold text-app-ink hover:text-app-accent"
                >
                  {entry.name}
                  <span className="flex-1 border-b border-dotted border-app-hairline-strong" />
                  <span className="font-mono text-[11px] font-normal text-app-muted">{chainLabel(entry.chains)} ↗</span>
                </a>
              ))}
            </div>
          ) : (
            <ol className="flex flex-col" onMouseLeave={() => setHovered(null)}>
              {rows.map((row, index) => {
                const here = connectedHere(row);
                const isConnected = here.evm || here.solana;
                const fit = fills(row);
                const disabled = pending !== null || fit.length === 0;
                return (
                  <li key={row.key} className="border-t border-app-hairline first:border-t-0">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void connect(row)}
                      onMouseEnter={() => setHovered(row.key)}
                      onFocus={() => setHovered(row.key)}
                      onBlur={() => setHovered(null)}
                      title={!isConnected && fit.length === 0 ? "Its chains are taken: unplug a port to switch" : undefined}
                      className="group flex w-full items-center gap-3 py-2.5 text-left disabled:cursor-default"
                    >
                      <span className="w-5 font-mono text-[11px] text-app-faint group-enabled:group-hover:text-app-accent">{String(index + 1).padStart(2, "0")}</span>
                      <WalletIcon icon={row.icon} name={row.name} className="size-8 shrink-0 rounded-lg" />
                      <span className={`text-[15px] font-semibold ${disabled && !isConnected ? "text-app-faint" : "text-app-ink"}`}>{row.name}</span>
                      <span className="mx-1 flex-1 translate-y-1 border-b border-dotted border-app-hairline-strong" />
                      {pending === row.key ? (
                        <Loader2 className="size-4 animate-spin text-app-muted" aria-label="Connecting" />
                      ) : isConnected ? (
                        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-app-up">plugged</span>
                      ) : (
                        <span className="font-mono text-[11px] text-app-muted group-enabled:group-hover:text-app-ink">
                          {chainLabel(CHAINS.filter((chain) => (chain === "evm" ? row.evm : row.solana)))}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <footer className="mt-auto border-t border-app-hairline px-5 py-3 text-[11px] leading-relaxed text-app-faint">
          Keys stay in your wallet. Angler asks it to sign only the trades you place, and reconnects later only to wallets plugged in here.
        </footer>
      </div>
    </div>
  );
}
