"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, type Account, type Chain, type EIP1193Provider, type Transport, type WalletClient } from "viem";

/** A wallet client with the connected account bound, so signTypedData needs no explicit account. */
export type AccountWalletClient = WalletClient<Transport, Chain | undefined, Account>;

/** An injected EVM wallet discovered through EIP-6963 (or the legacy window.ethereum). */
export interface EvmWallet {
  id: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

interface WalletContextValue {
  address: `0x${string}` | null;
  /** viem wallet client bound to the connected account; signs Hyperliquid approvals. */
  walletClient: AccountWalletClient | null;
  wallets: EvmWallet[];
  wallet: EvmWallet | null;
  isConnecting: boolean;
  connect: (wallet?: EvmWallet) => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Id of the wallet the user connected in this terminal. Set only on an explicit Connect click: wallet permissions are
 * per origin, so another app on the same origin (e.g. angler-news on localhost:3000) can authorize it, and that must
 * not connect the terminal on load.
 */
const CONNECTED_KEY = "angler:wallet:connected";
const LEGACY_ID = "injected";

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider");
  return context;
}

function firstAccount(accounts: unknown) {
  return Array.isArray(accounts) && typeof accounts[0] === "string" ? (accounts[0].toLowerCase() as `0x${string}`) : null;
}

function readConnectedId() {
  try {
    return localStorage.getItem(CONNECTED_KEY);
  } catch {
    return null;
  }
}

/** Injected EVM wallets (MetaMask, Rabby, Brave, Phantom, ...) via EIP-6963, falling back to window.ethereum. */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<EvmWallet[]>([]);
  const [wallet, setWallet] = useState<EvmWallet | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const restored = useRef(false);

  // Discover wallets. Each one announces itself; window.ethereum is only used when none do.
  useEffect(() => {
    const found = new Map<string, EvmWallet>();
    const publish = () => {
      const list = [...found.values()];
      if (list.length === 0 && window.ethereum) list.push({ id: LEGACY_ID, name: "Browser wallet", provider: window.ethereum });
      setWallets(list);
    };
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.info?.rdns || !detail.provider) return;
      found.set(detail.info.rdns, { id: detail.info.rdns, name: detail.info.name, icon: detail.info.icon, provider: detail.provider });
      publish();
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const fallback = window.setTimeout(publish, 300);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.clearTimeout(fallback);
    };
  }, []);

  // Silently restore only the wallet the user connected here before.
  useEffect(() => {
    if (restored.current || wallets.length === 0) return;
    const id = readConnectedId();
    const previous = id ? (wallets.find((entry) => entry.id === id) ?? (id === "1" ? wallets[0] : undefined)) : undefined;
    if (!previous) return;
    restored.current = true;
    previous.provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const account = firstAccount(accounts);
        if (account) {
          setWallet(previous);
          setAddress(account);
        }
      })
      .catch(() => {});
  }, [wallets]);

  // Follow account switches in the connected wallet; never connect from this event alone.
  useEffect(() => {
    if (!wallet) return;
    const onAccounts = (accounts: unknown) => {
      const account = firstAccount(accounts);
      setAddress(account);
      if (!account) setWallet(null);
    };
    wallet.provider.on?.("accountsChanged", onAccounts);
    return () => wallet.provider.removeListener?.("accountsChanged", onAccounts);
  }, [wallet]);

  const connect = useCallback(
    async (chosen?: EvmWallet) => {
      const target = chosen ?? wallets[0];
      if (!target) {
        window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer");
        return;
      }
      setIsConnecting(true);
      try {
        const accounts = await target.provider.request({ method: "eth_requestAccounts" });
        const account = firstAccount(accounts);
        if (!account) return;
        setWallet(target);
        setAddress(account);
        try {
          localStorage.setItem(CONNECTED_KEY, target.id);
        } catch {}
      } finally {
        setIsConnecting(false);
      }
    },
    [wallets],
  );

  const disconnect = useCallback(() => {
    setAddress(null);
    setWallet(null);
    try {
      localStorage.removeItem(CONNECTED_KEY);
    } catch {}
  }, []);

  const walletClient = useMemo(
    () => (address && wallet ? createWalletClient({ account: address, transport: custom(wallet.provider) }) : null),
    [address, wallet],
  );

  const value = useMemo(
    () => ({ address, walletClient, wallets, wallet, isConnecting, connect, disconnect }),
    [address, walletClient, wallets, wallet, isConnecting, connect, disconnect],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
