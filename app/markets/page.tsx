import type { Metadata } from "next";
import { MarketsTable } from "@/components/markets/markets-table";

export const metadata: Metadata = {
  title: "Markets",
  description: "Every perp on every venue the terminal trades: price, 24h change, volume, open interest, funding and the spread between venues.",
  alternates: { canonical: "/markets" },
};

export default function MarketsPage() {
  return <MarketsTable />;
}
