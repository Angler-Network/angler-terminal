import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Perp",
  description: "Trade Hyperliquid and Lighter perps from one order panel, routed to the cheaper venue, next to AI-scored news.",
  alternates: { canonical: "/perp" },
};

export default function PerpPage() {
  return <h1 className="sr-only">Angler Terminal: perps</h1>;
}
