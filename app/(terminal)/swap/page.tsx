import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Swap",
  description: "Swap tokens on Solana, Base, Arbitrum, Ethereum and Robinhood Chain at the best quote across Jupiter, Titan, Uniswap, Relay and LI.FI, next to AI-scored news.",
  alternates: { canonical: "/swap" },
};

export default function SwapPage() {
  return <h1 className="sr-only">Angler Terminal: swap</h1>;
}
