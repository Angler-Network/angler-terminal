import { PerpDexIcon, PredictionIcon, SpotDexIcon, SwapIcon, type NavIcon } from "./nav-icons";
import { predictionViewAvailable, swapViewAvailable } from "@/lib/deployment";
import { terminalKindOf } from "@/lib/terminal-kind";

export interface MarketNavItem {
  href: string;
  label: string;
  title: string;
  icon: NavIcon;
  /** Not live yet: the page says so and the nav marks it. */
  soon?: boolean;
  isActive: (pathname: string | null) => boolean;
}

/** The market views at the top of every navigation (sidebar, top bar, phone menu, home); no Swap or Prediction on testnet. */
export const marketNav: MarketNavItem[] = ([] as MarketNavItem[]).concat([
  { href: "/perp", label: "Perp Dex", title: "Perpetual futures on Hyperliquid and Lighter", icon: PerpDexIcon, isActive: (pathname) => terminalKindOf(pathname) === "perp" },
  { href: "/swap", label: "Swap", title: "Swap tokens and tokenized stocks", icon: SwapIcon, isActive: (pathname) => terminalKindOf(pathname) === "spot" },
  { href: "/spot", label: "Spot Dex", title: "Spot on Hyperliquid and Lighter order books, and Arcus stock tokens", icon: SpotDexIcon, isActive: (pathname) => terminalKindOf(pathname) === "book" },
  { href: "/prediction", label: "Prediction", title: "Prediction markets: Polymarket and Hyperliquid", icon: PredictionIcon, isActive: (pathname) => pathname === "/prediction" },
]).filter((item) => (item.href !== "/swap" || swapViewAvailable()) && (item.href !== "/prediction" || predictionViewAvailable()));
