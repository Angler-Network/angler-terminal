import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spot",
  description: "Trade Hyperliquid and Lighter spot markets on their order books, with market and limit orders, next to AI-scored news.",
  alternates: { canonical: "/spot" },
};

export default function SpotPage() {
  return <h1 className="sr-only">Angler Terminal: spot</h1>;
}
