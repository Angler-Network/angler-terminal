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
  { id: "hyperliquid", name: "Hyperliquid", kind: "Perps", chain: "evm", domain: "hyperliquid.xyz", color: "#0f3d36", live: true },
  { id: "jupiter", name: "Jupiter", kind: "Spot", chain: "solana", domain: "jup.ag", color: "#1f8a5b", live: true },
  { id: "lighter", name: "Lighter", kind: "Perps", chain: "evm", domain: "lighter.xyz", color: "#2a2a2a", live: true },
  { id: "titan", name: "Titan", kind: "Spot", chain: "solana", domain: "titan.exchange", color: "#5b3fd1", live: false },
  { id: "arcus", name: "Arcus", kind: "Stock tokens", chain: "evm", domain: "arcus.xyz", color: "#0d6e4f", live: true },
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

function VenueCard({ venue, address, walletName, network, onConnect, onDisconnect }: {
  venue: VenueOption;
  address: string | null;
  walletName?: string;
  network?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = venue.live && Boolean(address);
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors ${
        connected ? "border-app-up/40 bg-app-up/5" : venue.live ? "border-app-hairline hover:border-app-hairline-strong" : "border-app-hairline opacity-60"
      }`}
    >
      <VenueIcon venue={venue} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-app-ink">
          {venue.name}
          {network && <span className="rounded bg-app-chip px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">{network}</span>}
        </p>
        <p className="truncate text-[12px] text-app-muted">
          {connected && address ? (
            <>
              <span className="font-mono text-app-ink">{shortAddress(address)}</span>
              {walletName ? ` · ${walletName}` : ""}
            </>
          ) : (
            `${venue.kind} · ${chainLabel[venue.chain]}`
          )}
        </p>
      </div>
      {!venue.live ? (
        <span className="rounded-lg border border-app-hairline px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted">Soon</span>
      ) : connected ? (
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
          className="h-9 rounded-xl bg-app-accent px-4 text-[13px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85"
        >
          Connect
        </button>
      )}
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
            <p className="mt-1 text-[12px] text-app-muted">Pick where you want to trade. One wallet per chain covers every venue on it.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>

        {picking ? (
          <WalletPicker venue={picking} onBack={() => setPicking(null)} onDone={() => setPicking(null)} />
        ) : (
          <div className="flex flex-col gap-2">
            {VENUES.map((venue) => {
              const state = chainState(venue.chain);
              return (
                <VenueCard
                  key={venue.id}
                  venue={venue}
                  address={state.address}
                  walletName={state.walletName}
                  network={venue.id === "hyperliquid" ? network : venue.id === "lighter" ? lighterNetwork : venue.id === "arcus" ? arcusConfig.network : undefined}
                  onConnect={() => setPicking(venue)}
                  onDisconnect={state.disconnect}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
