import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spot",
  description: "Swap Solana tokens and tokenized stocks with the best quote across Jupiter, Titan and Arcus, next to AI-scored news.",
  alternates: { canonical: "/spot" },
};

export default function SpotPage() {
  return <h1 className="sr-only">Angler Terminal: spot</h1>;
}
