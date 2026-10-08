import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Perp Dex",
  description: "Trade perps on Hyperliquid, Lighter, Aster and Orderly from one order panel, routed to the cheapest venue, next to AI-scored news.",
  alternates: { canonical: "/perp" },
};

export default function PerpPage() {
  return <h1 className="sr-only">Angler Terminal: perps</h1>;
}
