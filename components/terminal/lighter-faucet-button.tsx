"use client";

import { useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { lighterConfig } from "@/lib/venues/lighter/config";
import { useTrading } from "./trading-provider";
import { useWallet } from "./wallet-provider";

/**
 * Testnet: requests test USDC from Lighter's faucet for the connected wallet (it also opens the Lighter account),
 * then refreshes the Lighter setup state. Renders nothing on mainnet or without a wallet.
 */
export function LighterFaucetButton({ className, label = "Get test USDC" }: { className?: string; label?: string }) {
  const toast = useToast();
  const { address } = useWallet();
  const { refreshLighter } = useTrading();
  const [busy, setBusy] = useState(false);
  if (lighterConfig.network !== "testnet" || !address) return null;

  const request = async () => {
    setBusy(true);
    try {
      const { requestTestFunds } = await import("@/lib/venues/lighter/api");
      await requestTestFunds(address);
      // The setup state can miss the new account on the first read (rate limits right after the faucet): retry.
      for (let attempt = 0; attempt < 4; attempt++) {
        if ((await refreshLighter())?.accountIndex != null) break;
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      toast({ tone: "success", title: "Test USDC received on Lighter", message: "Your Lighter testnet account is funded." });
    } catch (error) {
      toast({ tone: "error", title: "Lighter faucet", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" disabled={busy} onClick={() => void request()} className={className}>
      {busy ? "Requesting… (up to a minute)" : label}
    </button>
  );
}
