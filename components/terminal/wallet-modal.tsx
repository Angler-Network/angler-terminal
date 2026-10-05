"use client";

import { arcusConfig } from "@/lib/venues/arcus/config";
import { Check, ChevronLeft, Loader2, X } from "lucide-react";
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

type Chain = "evm" | "solana";

interface VenueOption {
  id: string;
  name: string;
  /** Product line shown under the name. */
  kind: string;
  chain: Chain;
  /** Site domain, used for its favicon through /api/favicon. */
  domain: string;
  /** Monogram tile color when the favicon can't load. */
  color: string;
  live: boolean;
}

const VENUES: VenueOption[] = [
  { id: "hyperliquid", name: "Hyperliquid", kind: "Perps", chain: "evm", domain: "hyperliquid.xyz", color: "#11806a", live: true },
  { id: "jupiter", name: "Jupiter", kind: "Spot", chain: "solana", domain: "jup.ag", color: "#1f8a5b", live: true },
  { id: "lighter", name: "Lighter", kind: "Perps", chain: "evm", domain: "lighter.xyz", color: "#3a3f4b", live: true },
  { id: "titan", name: "Titan", kind: "Spot", chain: "solana", domain: "titan.exchange", color: "#5b3fd1", live: true },
  { id: "arcus", name: "Arcus", kind: "Stocks", chain: "evm", domain: "arcus.xyz", color: "#2f8f4e", live: true },
];

const chainLabel: Record<Chain, string> = { evm: "EVM", solana: "Solana" };

function VenueIcon({ venue, size = 40 }: { venue: VenueOption; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-app-hairline-strong text-[15px] font-semibold text-white"
      style={{ width: size, height: size, background: failed ? venue.color : "rgb(var(--app-chip))" }}
    >
      {failed ? (
        venue.name.charAt(0)
      ) : (
        <img
          src={`/api/favicon?domain=${venue.domain}`}
          alt=""
          width={size * 0.55}
          height={size * 0.55}
          onError={() => setFailed(true)}
          className="object-contain"
          style={{ width: size * 0.55, height: size * 0.55 }}
        />
      )}
    </span>
  );
}

interface WalletChoice {
  key: string;
  name: string;
  icon?: string;
  connect: () => Promise<void>;
}

/** Wallet picker for one chain, shown after choosing a venue. */
function WalletPicker({ venue, onBack, onDone }: { venue: VenueOption; onBack: () => void; onDone: () => void }) {
  const toast = useToast();
  const evm = useWallet();
  const solana = useSolanaWallet();
  const [pending, setPending] = useState<string | null>(null);

  const choices: WalletChoice[] =
    venue.chain === "evm"
      ? evm.wallets.map((entry) => ({ key: entry.id, name: entry.name, icon: entry.icon, connect: () => evm.connect(entry) }))
      : solana.wallets.map((entry) => ({ key: entry.name, name: entry.name, icon: entry.icon, connect: () => solana.connect(entry) }));

  const pick = async (choice: WalletChoice) => {
    setPending(choice.key);
    try {
      await choice.connect();
      onDone();
    } catch (error) {
      toast({ tone: "error", title: "Couldn't connect", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 self-start text-[12px] font-semibold text-app-muted hover:text-app-ink">
        <ChevronLeft className="size-3.5" aria-hidden /> All venues
      </button>
      <div className="flex items-center gap-3">
        <VenueIcon venue={venue} />
        <div>
          <p className="text-[15px] font-semibold text-app-ink">Connect to {venue.name}</p>
          <p className="text-[12px] text-app-muted">Choose a {chainLabel[venue.chain]} wallet.</p>
        </div>
      </div>
      {choices.length === 0 ? (
        <a
          href={venue.chain === "evm" ? "https://metamask.io/download/" : "https://phantom.com/download"}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-dashed border-app-hairline-strong px-3 py-3 text-center text-[13px] font-semibold text-app-ink hover:bg-app-chip"
        >
          No {chainLabel[venue.chain]} wallet found. Install {venue.chain === "evm" ? "MetaMask or Rabby" : "Phantom or Solflare"}
        </a>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              disabled={pending !== null}
              onClick={() => void pick(choice)}
              className="flex items-center gap-2.5 rounded-xl border border-app-hairline px-3 py-2.5 text-left transition-colors hover:border-app-hairline-strong hover:bg-app-chip disabled:opacity-60"
            >
              {choice.icon ? <img src={choice.icon} alt="" className="size-6 rounded-md" /> : <span className="size-6 rounded-md bg-app-chip" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-app-ink">{choice.name}</span>
              {pending === choice.key && <Loader2 className="size-4 animate-spin text-app-muted" aria-label="Connecting" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One venue as a colored logo tile: compact so the grid keeps room as venues are added. A green dot marks a venue
 * whose chain already has a wallet connected.
 */
function VenueTile({ venue, connected, network, onPick }: { venue: VenueOption; connected: boolean; network?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!venue.live}
      title={`${venue.name} · ${venue.kind} · ${chainLabel[venue.chain]}${connected ? " · connected" : ""}`}
      style={{ background: `linear-gradient(145deg, ${venue.color}, color-mix(in srgb, ${venue.color} 55%, black))` }}
      className={`relative flex h-[92px] flex-col items-center justify-center gap-1.5 rounded-2xl border text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50 ${
        connected ? "border-app-up/70 ring-1 ring-app-up/40" : "border-white/10"
      }`}
    >
      {network === "testnet" && (
        <span className="absolute left-1.5 top-1.5 rounded bg-black/35 px-1 py-[1px] text-[8px] font-bold uppercase tracking-[0.08em] text-white/80">Test</span>
      )}
      {connected && <span aria-label="Connected" className="absolute right-2 top-2 size-2 rounded-full bg-app-up shadow-[0_0_0_3px_rgba(0,0,0,0.25)]" />}
      <VenueIcon venue={venue} size={38} />
      <span className="text-[12px] font-semibold leading-none">{venue.name}</span>
      <span className="text-[10px] leading-none text-white/70">{venue.kind}</span>
    </button>
  );
}

function ConnectedWallet({ chain, address, walletName, onDisconnect }: { chain: Chain; address: string; walletName?: string; onDisconnect: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-app-up/30 bg-app-up/5 px-3 py-2 text-[12px]">
      <Check className="size-3.5 text-app-up" aria-hidden />
      <span className="font-semibold text-app-ink">{chainLabel[chain]}</span>
      <span className="font-mono text-app-muted">{shortAddress(address)}</span>
      {walletName && <span className="truncate text-app-faint">· {walletName}</span>}
      <button type="button" onClick={onDisconnect} className="ml-auto font-semibold text-app-muted hover:text-app-ink">
        Disconnect
      </button>
    </div>
  );
}

/** Connect by venue: each card opens the wallets for that venue's chain. */
function WalletModal() {
  const { isOpen, close } = useWalletModal();
  const evm = useWallet();
  const solana = useSolanaWallet();
  const { network, lighterNetwork } = useTrading();
  const [picking, setPicking] = useState<VenueOption | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPicking(null);
      return;
    }
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const chainState = (chain: Chain) =>
    chain === "evm"
      ? { address: evm.address, walletName: evm.wallet?.name, disconnect: evm.disconnect }
      : { address: solana.address, walletName: solana.wallet?.name, disconnect: () => void solana.disconnect() };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu flex w-full max-w-md flex-col gap-4 rounded-3xl border border-app-hairline-strong bg-app-dialog p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="wallet-modal-title" className="text-[18px] font-semibold text-app-ink">
              Connect a venue
            </h2>
            <p className="mt-1 text-[12px] text-app-muted">Tap a venue to connect. One wallet per chain covers every venue on it.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>

        {picking ? (
          <WalletPicker venue={picking} onBack={() => setPicking(null)} onDone={() => setPicking(null)} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {VENUES.map((venue) => (
                <VenueTile
                  key={venue.id}
                  venue={venue}
                  connected={Boolean(chainState(venue.chain).address)}
                  network={venue.id === "hyperliquid" ? network : venue.id === "lighter" ? lighterNetwork : venue.id === "arcus" ? arcusConfig.network : undefined}
                  onPick={() => setPicking(venue)}
                />
              ))}
            </div>
            {(["evm", "solana"] as const).map((chain) => {
              const state = chainState(chain);
              return state.address ? (
                <ConnectedWallet key={chain} chain={chain} address={state.address} walletName={state.walletName} onDisconnect={state.disconnect} />
              ) : null;
            })}
          </>
        )}
      </div>
    </div>
  );
}
