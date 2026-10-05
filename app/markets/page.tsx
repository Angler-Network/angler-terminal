import type { Metadata } from "next";
import { MarketsTable } from "@/components/markets/markets-table";

export const metadata: Metadata = { title: "Markets" };

export default function MarketsPage() {
  return <MarketsTable />;
}
