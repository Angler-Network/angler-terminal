"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSolanaWallet } from "@/components/terminal/solana-wallet-provider";
import { useWallet } from "@/components/terminal/wallet-provider";
import { base58 } from "@/lib/profile/base58";
import { profileMessage, type ProfileAction } from "@/lib/profile/identity";
import { TRADE_EVENT } from "@/lib/profile/client";
import type { ProfileView } from "@/lib/profile/store";

const REFRESH_MS = 5 * 60_000;
const AFTER_TRADE_MS = 8_000;

interface ProfileContextValue {
  /** The connected wallet's profile id: the EVM address, else the Solana one. */
  id: string | null;
  profile: ProfileView | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Signs the username change with the profile's wallet and saves it; resolves to an error message or null. */
  saveUsername: (username: string) => Promise<string | null>;
  /** Signs with the Solana wallet to count its swaps on the EVM profile. */
  linkSolana: (() => Promise<string | null>) | null;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) throw new Error("useProfile must be used within ProfileProvider");
  return context;
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (${response.status}).`;
}

async function postSigned(path: string, message: string, signature: string) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
  return response.ok ? null : readError(response);
}

/**
 * The connected wallet's profile (username, points, level, rank), shared by the top bar and the profile page.
 * Loads with a venue sync, refreshes every few minutes and shortly after each trade.
 */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { address: evmAddress, getWalletClient } = useWallet();
  const { address: solanaAddress, signMessage } = useSolanaWallet();
  const id = evmAddress ?? solanaAddress;
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/profile/${encodeURIComponent(id)}?sync=1`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const next = (await response.json()) as ProfileView;
      // A Solana wallet linked to an EVM profile shows that profile.
      const shown = next.linkedTo && !evmAddress ? ((await (await fetch(`/api/profile/${next.linkedTo}`, { cache: "no-store" })).json()) as ProfileView) : next;
      if (ticket === request.current) {
        setProfile(shown);
        setError(null);
      }
    } catch (failure) {
      if (ticket === request.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [id, evmAddress]);

  useEffect(() => {
    setProfile(null);
    if (!id) return;
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    let pending: number | null = null;
    const onTrade = () => {
      if (pending !== null) window.clearTimeout(pending);
      pending = window.setTimeout(() => void load(), AFTER_TRADE_MS);
    };
    window.addEventListener(TRADE_EVENT, onTrade);
    return () => {
      window.clearInterval(timer);
      if (pending !== null) window.clearTimeout(pending);
      window.removeEventListener(TRADE_EVENT, onTrade);
    };
  }, [id, load]);

  const sign = useCallback(
    async (action: ProfileAction, wallet: "evm" | "solana") => {
      const signer = wallet === "evm" ? evmAddress : solanaAddress;
      if (!signer) throw new Error("Connect the wallet first.");
      const message = profileMessage(action, signer, new Date().toISOString());
      if (wallet === "evm") {
        if (!getWalletClient) throw new Error("Connect the wallet first.");
        const client = await getWalletClient();
        return { message, signature: await client.signMessage({ message }) };
      }
      if (!signMessage) throw new Error("This Solana wallet can't sign messages.");
      return { message, signature: base58(await signMessage(message)) };
    },
    [evmAddress, solanaAddress, getWalletClient, signMessage],
  );

  const saveUsername = useCallback(
    async (username: string) => {
      try {
        const { message, signature } = await sign({ kind: "username", username }, evmAddress ? "evm" : "solana");
        const failure = await postSigned("/api/profile/username", message, signature);
        if (!failure) setProfile((current) => (current ? { ...current, username } : current));
        return failure;
      } catch (failure) {
        return failure instanceof Error ? failure.message : String(failure);
      }
    },
    [sign, evmAddress],
  );

  const canLink = Boolean(evmAddress && solanaAddress && signMessage && profile && !profile.linkedWallets.includes(solanaAddress));
  const linkSolana = useCallback(async () => {
    if (!evmAddress) return "Connect an EVM wallet first.";
    try {
      const { message, signature } = await sign({ kind: "link", profile: evmAddress }, "solana");
      const failure = await postSigned("/api/profile/link", message, signature);
      if (!failure) void load();
      return failure;
    } catch (failure) {
      return failure instanceof Error ? failure.message : String(failure);
    }
  }, [sign, evmAddress, load]);

  const value = useMemo(
    () => ({ id, profile, loading, error, refresh: () => void load(), saveUsername, linkSolana: canLink ? linkSolana : null }),
    [id, profile, loading, error, load, saveUsername, canLink, linkSolana],
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
