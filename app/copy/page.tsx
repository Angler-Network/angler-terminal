import type { Metadata } from "next";
import { CopyView } from "@/components/copy/copy-view";

export const metadata: Metadata = {
  title: "Copy trading",
  description: "Follow Hyperliquid and Lighter wallets, get Telegram or Discord alerts when they trade, and copy them on any perp venue.",
  alternates: { canonical: "/copy" },
};

export default function CopyPage() {
  return <CopyView />;
}
