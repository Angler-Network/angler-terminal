"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, type Account, type Chain, type EIP1193Provider, type Transport, type WalletClient } from "viem";

/** A wallet client with the connected account bound, so signTypedData needs no explicit account. */
export type AccountWalletClient = WalletClient<Transport, Chain | undefined, Account>;

interface WalletContextValue {
  address: `0x${string}` | null;
  /** viem wallet client bound to the connected account; signs Hyperliquid approvals. */
  walletClient: AccountWalletClient | null;
  hasProvider: boolean;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Set only when the user clicks Connect in this terminal. Wallet permissions are per origin, so another app on the
 * same origin (e.g. angler-news on localhost:3000) can authorize it; that must not connect the terminal on load.
 */
const CONNECTED_KEY = "angler:wallet:connected";

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

/** Injected-wallet connection (MetaMask, Rabby, ...) through EIP-1193. */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const provider = window.ethereum;
    setHasProvider(Boolean(provider));
    if (!provider) return;
    let connectedHere = false;
    try {
      connectedHere = localStorage.getItem(CONNECTED_KEY) === "1";
    } catch {}
    if (connectedHere) {
      provider
        .request({ method: "eth_accounts" })
        .then((accounts) => setAddress(firstAccount(accounts)))
        .catch(() => {});
    }
    // Follow account switches only while connected here; never connect from this event alone.
    const onAccounts = (accounts: unknown) =>
      setAddress((current) => (current ? firstAccount(accounts) : current));
    provider.on?.("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const connect = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer");
      return;
    }
    setIsConnecting(true);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      setAddress(firstAccount(accounts));
      try {
        localStorage.setItem(CONNECTED_KEY, "1");
      } catch {}
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    try {
      localStorage.removeItem(CONNECTED_KEY);
    } catch {}
  }, []);

  const walletClient = useMemo(
    () => (address && window.ethereum ? createWalletClient({ account: address, transport: custom(window.ethereum) }) : null),
    [address],
  );

  const value = useMemo(
    () => ({ address, walletClient, hasProvider, isConnecting, connect, disconnect }),
    [address, walletClient, hasProvider, isConnecting, connect, disconnect],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
