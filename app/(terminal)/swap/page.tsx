import type { Metadata } from "next";
import { preload } from "react-dom";
import { SPOT_LISTINGS_PATH } from "@/lib/spot/listings";

export const metadata: Metadata = {
  title: "Swap",
  description: "Swap tokens on Solana, Base, Arbitrum, Ethereum and Robinhood Chain at the best quote across Jupiter, Titan, Uniswap, Relay and LI.FI, next to AI-scored news.",
  alternates: { canonical: "/swap" },
};

export default function SwapPage() {
  // The token search and the chart read the spot listings (~300 kB): start them with the HTML, not after hydration.
  preload(SPOT_LISTINGS_PATH, { as: "fetch", crossOrigin: "anonymous" });
  return <h1 className="sr-only">Angler Terminal: swap</h1>;
}
