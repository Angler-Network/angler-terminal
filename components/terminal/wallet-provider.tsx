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

const DISCONNECTED_KEY = "angler:wallet:disconnected";

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
    let wasDisconnected = false;
    try {
      wasDisconnected = localStorage.getItem(DISCONNECTED_KEY) === "1";
    } catch {}
    if (!wasDisconnected) {
      provider
        .request({ method: "eth_accounts" })
        .then((accounts) => setAddress(firstAccount(accounts)))
        .catch(() => {});
    }
    const onAccounts = (accounts: unknown) => setAddress(firstAccount(accounts));
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
        localStorage.removeItem(DISCONNECTED_KEY);
      } catch {}
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    try {
      localStorage.setItem(DISCONNECTED_KEY, "1");
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
