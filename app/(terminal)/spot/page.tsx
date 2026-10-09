import type { Metadata } from "next";
import { preload } from "react-dom";
import { SPOT_LISTINGS_PATH } from "@/lib/spot/listings";

export const metadata: Metadata = {
  title: "Spot Dex",
  description: "Trade Hyperliquid and Lighter spot on their order books with market and limit orders, and Robinhood Chain stock tokens on Arcus, next to AI-scored news.",
  alternates: { canonical: "/spot" },
};

export default function SpotPage() {
  // The token search and the order panel read the spot listings (~300 kB): start them with the HTML, not after hydration.
  preload(SPOT_LISTINGS_PATH, { as: "fetch", crossOrigin: "anonymous" });
  return <h1 className="sr-only">Angler Terminal: spot</h1>;
}
