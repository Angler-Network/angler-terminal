import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Swap",
  description: "Swap Solana tokens and tokenized stocks with the best quote across Jupiter, Titan and Arcus, next to AI-scored news.",
  alternates: { canonical: "/swap" },
};

export default function SwapPage() {
  return <h1 className="sr-only">Angler Terminal: swap</h1>;
}
