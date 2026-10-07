import { CandlestickChart, Coins, Target, type LucideIcon } from "lucide-react";
import { terminalKindOf } from "@/lib/terminal-kind";

export interface MarketNavItem {
  href: string;
  label: string;
  title: string;
  icon: LucideIcon;
  /** Not live yet: the page says so and the nav marks it. */
  soon?: boolean;
  isActive: (pathname: string | null) => boolean;
}

/** The market views at the top of every navigation (sidebar, top bar, phone menu). */
export const marketNav: MarketNavItem[] = [
  { href: "/perp", label: "Perp", title: "Perpetual futures", icon: CandlestickChart, isActive: (pathname) => terminalKindOf(pathname) === "perp" },
  { href: "/swap", label: "Swap", title: "Swap tokens and tokenized stocks", icon: Coins, isActive: (pathname) => terminalKindOf(pathname) === "spot" },
  { href: "/prediction", label: "Prediction", title: "Prediction markets: Polymarket and Hyperliquid", icon: Target, isActive: (pathname) => pathname === "/prediction" },
];
