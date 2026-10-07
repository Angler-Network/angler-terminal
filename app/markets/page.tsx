import type { Metadata } from "next";
import { MarketsTable } from "@/components/markets/markets-table";

export const metadata: Metadata = {
  title: "Markets",
  description: "Every tradable perp with funding rates on Hyperliquid, Lighter, Binance and Bybit, and the spread between venues.",
  alternates: { canonical: "/markets" },
};

export default function MarketsPage() {
  return <MarketsTable />;
}
