"use client";

import { venueAvailable, type VenueKey } from "@/lib/deployment";
import { Check, Loader2, LogOut, X } from "lucide-react";
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

type Chain = "evm" | "solana";

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

/** The venues each chain's wallet unlocks, drawn on the orbit. */
const ORBIT: Record<Chain, Array<{ id: VenueKey; name: string; domain: string }>> = {
  evm: [
    { id: "hyperliquid", name: "Hyperliquid", domain: "hyperliquid.xyz" },
    { id: "lighter", name: "Lighter", domain: "lighter.xyz" },
    { id: "lighterRh", name: "Lighter RH", domain: "robinhood.com" },
    { id: "arcus", name: "Arcus", domain: "arcus.xyz" },
  ],
  solana: [
    { id: "jupiter", name: "Jupiter", domain: "jup.ag" },
    { id: "titan", name: "Titan", domain: "titan.exchange" },
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

function VenueDot({ domain, name, lit }: { domain: string; name: string; lit: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      title={name}
      className={`flex size-9 items-center justify-center overflow-hidden rounded-full border bg-app-dialog transition-[opacity,border-color,box-shadow] duration-500 ${
        lit ? "border-app-accent/70 opacity-100 shadow-[0_0_18px_-2px_rgb(var(--app-accent)/0.65)]" : "border-app-hairline-strong opacity-45"
      }`}
    >
      {failed ? (
        <span className="text-[11px] font-bold text-app-ink">{name.charAt(0)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/favicon?domain=${domain}`} alt="" width={20} height={20} onError={() => setFailed(true)} className="size-5 object-contain" />
      )}
    </span>
  );
}

/**
 * Two rings around the Angler mark: EVM venues inside, Solana venues outside. A ring lights up as soon as its
 * chain has a wallet, so the user sees what one connection unlocks. The rings drift slowly (not under reduced
 * motion); the venue marks counter-rotate to stay upright.
 */
function Orbit({ lit }: { lit: Record<Chain, boolean> }) {
  const rings = (["evm", "solana"] as const).map((chain, ring) => ({
    chain,
    radius: ring === 0 ? 74 : 122,
    venues: ORBIT[chain].filter((venue) => venueAvailable(venue.id)),
  }));
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[290px]" aria-hidden>
      <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgb(var(--app-accent)/0.22),transparent_65%)] blur-2xl" />
      {rings.map(({ chain, radius, venues }, ring) => (
        <div
          key={chain}
          className={`absolute left-1/2 top-1/2 rounded-full border motion-safe:animate-[spin_70s_linear_infinite] ${ring === 1 ? "motion-safe:[animation-direction:reverse]" : ""} ${
            lit[chain] ? "border-app-accent/45" : "border-dashed border-app-hairline-strong"
          }`}
          style={{ width: radius * 2, height: radius * 2, marginLeft: -radius, marginTop: -radius }}
        >
          {venues.map((venue, index) => {
            const angle = (index / venues.length) * 2 * Math.PI + (ring === 0 ? -Math.PI / 2 : Math.PI / 4);
            return (
              <span
                key={venue.id}
                className={`absolute motion-safe:animate-[spin_70s_linear_infinite] ${ring === 1 ? "" : "motion-safe:[animation-direction:reverse]"}`}
                style={{ left: radius + radius * Math.cos(angle) - 18, top: radius + radius * Math.sin(angle) - 18 }}
              >
                <VenueDot domain={venue.domain} name={venue.name} lit={lit[chain]} />
              </span>
            );
          })}
        </div>
      ))}
      <div className="absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-app-hairline-strong bg-app-dialog shadow-[0_10px_40px_-10px_rgb(var(--app-accent)/0.6)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/whitelogo.png" alt="" width={30} height={30} className="hidden size-[30px] [html[data-tone=dark]_&]:block" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/blacklogo.png" alt="" width={30} height={30} className="size-[30px] [html[data-tone=dark]_&]:hidden" />
      </div>
    </div>
  );
}

function ChainChip({ chain, active }: { chain: Chain; active: boolean }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${
        active ? "bg-app-up/15 text-app-up" : "bg-app-chip text-app-muted"
      }`}
    >
      {chain === "evm" ? "EVM" : "SOL"}
    </span>
  );
}

const INSTALL: Array<{ name: string; url: string; chains: Chain[] }> = [
  { name: "Phantom", url: "https://phantom.com/download", chains: ["evm", "solana"] },
  { name: "Rabby", url: "https://rabby.io", chains: ["evm"] },
  { name: "MetaMask", url: "https://metamask.io/download/", chains: ["evm"] },
];

/**
 * One screen, no venue picking: every wallet the browser has, merged across chains. A press connects each chain the
 * wallet supports that isn't connected yet, and the orbit shows which venues that unlocked.
 */
function WalletModal() {
  const { isOpen, close } = useWalletModal();
  const toast = useToast();
  const evm = useWallet();
  const solana = useSolanaWallet();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const rows = useMemo(() => mergeWallets(evm.wallets, solana.wallets), [evm.wallets, solana.wallets]);
  const backdropRef = useModalEnter(isOpen);
  if (!isOpen) return null;

  const lit = { evm: Boolean(evm.address), solana: Boolean(solana.address) };
  const connectedHere = (row: WalletRow) => ({
    evm: Boolean(row.evm && evm.address && evm.wallet?.id === row.evm.id),
    solana: Boolean(row.solana && solana.address && solana.wallet?.name === row.solana.name),
  });

  const connect = async (row: WalletRow) => {
    setPending(row.key);
    try {
      // Each chain this wallet covers that has no wallet yet; one press can open both.
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

  const disconnect = (row: WalletRow) => {
    const here = connectedHere(row);
    if (here.evm) evm.disconnect();
    if (here.solana) void solana.disconnect();
  };

  const venueCount = (chain: Chain) => ORBIT[chain].filter((venue) => venueAvailable(venue.id)).length;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[3px]" ref={backdropRef} role="presentation" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle relative grid max-h-[calc(100dvh-2rem)] w-full max-w-[760px] overflow-y-auto rounded-[28px] border border-app-hairline-strong bg-app-dialog shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] md:grid-cols-[1fr_1.05fr]"
      >
        <button type="button" onClick={close} aria-label="Close" className="absolute right-4 top-4 z-10 rounded-lg p-1 text-app-faint hover:text-app-ink">
          <X className="size-4" />
        </button>

        <section className="relative flex flex-col justify-between gap-6 overflow-hidden border-app-hairline p-6 max-md:border-b md:border-r">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgb(var(--app-accent)/0.14),transparent_60%)]" />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-app-accent">Angler Terminal</p>
            <h2 id="wallet-modal-title" className="mt-2 text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] text-app-ink">
              Connect once.
              <br />
              Trade everywhere.
            </h2>
          </div>
          <div className="relative max-md:hidden">
            <Orbit lit={lit} />
          </div>
          <dl className="relative grid grid-cols-2 gap-2 text-[12px]">
            {(["evm", "solana"] as const).map((chain) => (
              <div key={chain} className={`rounded-xl border px-3 py-2 transition-colors ${lit[chain] ? "border-app-accent/40 bg-app-accent/[0.06]" : "border-app-hairline"}`}>
                <dt className="flex items-center gap-1.5 font-semibold text-app-ink">
                  <span className={`size-1.5 rounded-full ${lit[chain] ? "bg-app-up shadow-[0_0_8px_rgb(var(--app-up))]" : "bg-app-faint"}`} />
                  {chain === "evm" ? "EVM" : "Solana"}
                </dt>
                <dd className="mt-0.5 truncate text-app-muted">
                  {chain === "evm" ? (evm.address ? shortAddress(evm.address) : `${venueCount("evm")} venues`) : solana.address ? shortAddress(solana.address) : `${venueCount("solana")} venues`}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex min-h-0 flex-col gap-3 p-6">
          <div>
            <p className="text-[15px] font-semibold text-app-ink">Your wallets</p>
            <p className="mt-0.5 text-[12px] text-app-muted">Pick one. Wallets that hold both EVM and Solana connect both in a single step.</p>
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="rounded-xl border border-dashed border-app-hairline-strong px-3 py-3 text-[13px] text-app-muted">No wallet found in this browser. Install one, then come back:</p>
              {INSTALL.map((entry) => (
                <a
                  key={entry.name}
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-app-hairline px-3 py-2.5 text-[14px] font-semibold text-app-ink hover:border-app-hairline-strong hover:bg-app-chip"
                >
                  {entry.name}
                  <span className="flex gap-1">
                    {entry.chains.map((chain) => (
                      <ChainChip key={chain} chain={chain} active={false} />
                    ))}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => {
                const here = connectedHere(row);
                const isConnected = here.evm || here.solana;
                // Nothing left to connect for this wallet: its chains are taken (maybe by another wallet).
                const blocked = !isConnected && !(row.evm && !evm.address) && !(row.solana && !solana.address);
                return (
                  <li key={row.key}>
                    <div
                      className={`group flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-[border-color,background-color,transform] ${
                        isConnected ? "border-app-up/40 bg-app-up/[0.05]" : "border-app-hairline hover:-translate-y-px hover:border-app-hairline-strong hover:bg-app-chip/60"
                      }`}
                    >
                      {row.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.icon} alt="" className="size-9 shrink-0 rounded-xl" />
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-app-chip text-[14px] font-bold text-app-ink">{row.name.charAt(0)}</span>
                      )}
                      <button
                        type="button"
                        disabled={pending !== null || isConnected || blocked}
                        onClick={() => void connect(row)}
                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                        title={blocked ? "Disconnect the current wallet first to switch" : undefined}
                      >
                        <span className="block truncate text-[14px] font-semibold text-app-ink">{row.name}</span>
                        <span className="mt-0.5 flex items-center gap-1">
                          {row.evm && <ChainChip chain="evm" active={here.evm} />}
                          {row.solana && <ChainChip chain="solana" active={here.solana} />}
                          {isConnected && (
                            <span className="ml-1 truncate font-mono text-[11px] text-app-muted">
                              {here.evm && evm.address ? shortAddress(evm.address) : solana.address ? shortAddress(solana.address) : ""}
                            </span>
                          )}
                        </span>
                      </button>
                      {pending === row.key ? (
                        <Loader2 className="size-4 animate-spin text-app-muted" aria-label="Connecting" />
                      ) : isConnected ? (
                        <span className="flex items-center gap-1">
                          <Check className="size-4 text-app-up" aria-label="Connected" />
                          <button type="button" onClick={() => disconnect(row)} title="Disconnect" aria-label={`Disconnect ${row.name}`} className="rounded-md p-1 text-app-faint hover:text-app-down">
                            <LogOut className="size-3.5" />
                          </button>
                        </span>
                      ) : (
                        <span className={`text-[12px] font-semibold ${blocked ? "text-app-faint" : "text-app-accent opacity-0 transition-opacity group-hover:opacity-100"}`}>
                          {blocked ? "In use" : "Connect"}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-auto pt-2 text-[11px] leading-relaxed text-app-faint">
            Your keys never leave your wallet. Angler only asks it to sign the trades you place, and reconnects on later visits only to wallets you
            connected here.
          </p>
        </section>
      </div>
    </div>
  );
}
