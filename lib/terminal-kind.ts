/**
 * The terminal has a perp and a spot view (`/perp`, and `/swap`, where spot trades are swaps; the old `/spot` redirects
 * there), picked from the sidebar. Both render the same shell from
 * `app/(terminal)/layout.tsx`, so switching keeps the chart, books and news feed alive; only the order panel's market
 * type follows the path.
 */
export type TerminalKind = "perp" | "spot";

export const TERMINAL_PATHS: Record<TerminalKind, string> = { perp: "/perp", spot: "/swap" };

/** The terminal view a path shows, or null outside the terminal. */
export function terminalKindOf(pathname: string | null | undefined): TerminalKind | null {
  if (pathname === "/perp" || pathname?.startsWith("/perp/")) return "perp";
  if (pathname === "/swap" || pathname?.startsWith("/swap/")) return "spot";
  return null;
}
