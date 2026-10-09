import type { Metadata } from "next";
import { StatusScreen } from "@/components/app/status-screen";

export const metadata: Metadata = {
  title: "CEX",
  description: "Centralized exchanges in the Angler terminal: coming soon.",
  robots: { index: false },
};

/** The CEX view isn't built yet: the nav shows it with a Soon badge and this page says so. */
export default function CexPage() {
  return (
    <StatusScreen
      mark="Soon"
      title="Centralized exchanges are coming"
      description="Trade on centralized exchanges from the same terminal, next to the news that moves the market."
      primary={{ href: "/perp", label: "Trade perp" }}
      secondary={{ href: "/markets", label: "Browse markets" }}
    />
  );
}
