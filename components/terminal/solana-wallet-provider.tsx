"use client";

import { SolanaSignTransaction, type SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { TransactionSigner } from "@/lib/venues/types";

const SOLANA_MAINNET = "solana:mainnet";
const LAST_WALLET_KEY = "angler:solana:wallet";

interface SolanaWalletContextValue {
  wallets: Wallet[];
  wallet: Wallet | null;
  address: string | null;
  connect: (wallet: Wallet) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Signs a base64 transaction with the connected account (partial signing: other signers may be added later). */
  signTransaction: TransactionSigner | null;
}

const SolanaWalletContext = createContext<SolanaWalletContextValue | null>(null);

export function useSolanaWallet() {
  const context = useContext(SolanaWalletContext);
  if (!context) throw new Error("useSolanaWallet must be used within SolanaWalletProvider");
  return context;
}

function isSolanaWallet(wallet: Wallet) {
  return (
    wallet.chains.some((chain) => chain.startsWith("solana:")) && SolanaSignTransaction in wallet.features && StandardConnect in wallet.features
  );
}

function toBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

/** Solana wallets via the Wallet Standard (Phantom, Solflare, Backpack, ...). */
export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);

  useEffect(() => {
    const registry = getWallets();
    const refresh = () => setWallets(registry.get().filter(isSolanaWallet));
    refresh();
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  // Reconnect silently to the last wallet the user picked.
  useEffect(() => {
    if (wallet) return;
    let name: string | null = null;
    try {
      name = localStorage.getItem(LAST_WALLET_KEY);
    } catch {}
    const previous = name ? wallets.find((entry) => entry.name === name) : undefined;
    if (!previous) return;
    (previous.features as StandardConnectFeature)[StandardConnect]
      .connect({ silent: true })
      .then(({ accounts }) => {
        if (accounts[0]) {
          setWallet(previous);
          setAccount(accounts[0]);
        }
      })
      .catch(() => {});
  }, [wallets, wallet]);

  useEffect(() => {
    if (!wallet || !(StandardEvents in wallet.features)) return;
    return (wallet.features as StandardEventsFeature)[StandardEvents].on("change", ({ accounts }) => {
      if (accounts) setAccount(accounts[0] ?? null);
    });
  }, [wallet]);

  const connect = useCallback(async (next: Wallet) => {
    const { accounts } = await (next.features as StandardConnectFeature)[StandardConnect].connect();
    const solanaAccount = accounts.find((entry) => entry.chains.some((chain) => chain.startsWith("solana:"))) ?? accounts[0];
    if (!solanaAccount) throw new Error("The wallet returned no Solana account.");
    setWallet(next);
    setAccount(solanaAccount);
    try {
      localStorage.setItem(LAST_WALLET_KEY, next.name);
    } catch {}
  }, []);

  const disconnect = useCallback(async () => {
    if (wallet && StandardDisconnect in wallet.features) {
      await (wallet.features as StandardDisconnectFeature)[StandardDisconnect].disconnect().catch(() => {});
    }
    setWallet(null);
    setAccount(null);
    try {
      localStorage.removeItem(LAST_WALLET_KEY);
    } catch {}
  }, [wallet]);

  const signTransaction = useMemo<TransactionSigner | null>(() => {
    if (!wallet || !account) return null;
    const feature = (wallet.features as SolanaSignTransactionFeature)[SolanaSignTransaction];
    return async (transactionBase64) => {
      const [output] = await feature.signTransaction({ account, transaction: toBytes(transactionBase64), chain: SOLANA_MAINNET });
      if (!output) throw new Error("The wallet returned no signed transaction.");
      return toBase64(output.signedTransaction);
    };
  }, [wallet, account]);

  const value = useMemo(
    () => ({ wallets, wallet, address: account?.address ?? null, connect, disconnect, signTransaction }),
    [wallets, wallet, account, connect, disconnect, signTransaction],
  );
  return <SolanaWalletContext.Provider value={value}>{children}</SolanaWalletContext.Provider>;
}
