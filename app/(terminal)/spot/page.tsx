import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dex Spot",
  description: "Trade Hyperliquid and Lighter spot on their order books with market and limit orders, and Robinhood Chain stock tokens on Arcus, next to AI-scored news.",
  alternates: { canonical: "/spot" },
};

export default function SpotPage() {
  return <h1 className="sr-only">Angler Terminal: spot</h1>;
}
