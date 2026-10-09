import type { Metadata } from "next";
import { VaultsView } from "@/components/vaults/vaults-view";

export const metadata: Metadata = {
  title: "Vaults",
  description: "Hyperliquid, Lighter and Orderly vaults side by side: TVL, APR, returns, drawdown, manager share and lock-up.",
  alternates: { canonical: "/vaults" },
};

export default function VaultsPage() {
  return <VaultsView />;
}
