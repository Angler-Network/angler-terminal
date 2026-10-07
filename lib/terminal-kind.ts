/**
 * The terminal has three views, picked from the navigation: perps (`/perp`), swaps through pools and aggregators
 * (`/swap`: Jupiter, Titan, Uniswap, Arcus, Relay, LI.FI; the market kind stays `"spot"` in the code) and order-book
 * spot (`/spot`, kind `"book"`: Hyperliquid and Lighter spot, later centralized exchanges). All render the same shell
 * from `app/(terminal)/layout.tsx`, so switching keeps the chart, books and news feed alive; only the panels follow
 * the path.
 */
export type TerminalKind = "perp" | "spot" | "book";

export const TERMINAL_PATHS: Record<TerminalKind, string> = { perp: "/perp", spot: "/swap", book: "/spot" };

/** The terminal view a path shows, or null outside the terminal. */
export function terminalKindOf(pathname: string | null | undefined): TerminalKind | null {
  if (pathname === "/perp" || pathname?.startsWith("/perp/")) return "perp";
  if (pathname === "/swap" || pathname?.startsWith("/swap/")) return "spot";
  if (pathname === "/spot" || pathname?.startsWith("/spot/")) return "book";
  return null;
}
