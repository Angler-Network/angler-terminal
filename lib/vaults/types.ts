/**
 * Vaults across the perp venues in one shape: Hyperliquid vaults (HLP and user vaults), Lighter and Lighter RH public
 * pools (LLP and user pools) and Orderly strategy vaults (OmniVault and community vaults). Hyperliquid and Lighter
 * deposits and withdrawals run in the terminal (`transfer.ts`); Orderly's open the venue's own page.
 */

export type VaultVenue = "hyperliquid" | "lighter" | "lighterRh" | "orderly";

export const VAULT_VENUE_NAMES: Record<VaultVenue, string> = {
  hyperliquid: "Hyperliquid",
  lighter: "Lighter",
  lighterRh: "Lighter RH",
  orderly: "Orderly",
};

export interface VaultRow {
  venue: VaultVenue;
  /** HL vault address, Lighter pool account index, Orderly vault id. */
  id: string;
  name: string;
  /** Run by the venue itself (HLP, LLP, OmniVault) or by a trader. */
  kind: "protocol" | "user";
  /** Leader address (HL), operator address (Lighter) or strategy provider name (Orderly). */
  manager: string | null;
  tvl: number;
  /**
   * The yearly rate the venue itself shows, as a fraction (0.12 = 12%). Each venue computes it its own way, so rows
   * aren't strictly comparable on it; the detail view computes returns the same way for every vault.
   */
  apr: number | null;
  /** How the venue's `apr` is meant, for the tooltip. */
  aprBasis: string;
  /** When the vault started (ms). */
  createdAt: number | null;
  /** Share of the profits the manager keeps (0.1 = 10%), when known. */
  profitShare: number | null;
  /** Hours a deposit stays locked, when known. */
  lockHours: number | null;
  /** Open for deposits. */
  open: boolean;
  /** Price of one pool share in USD (Lighter), to value a wallet's shares. */
  sharePrice?: number;
  /** Sharpe ratio as reported (Lighter). */
  sharpe?: number | null;
  minDeposit?: number | null;
  /** The venue's page for this vault, where deposits happen. */
  url: string;
}

/** One vault's performance, computed the same way for every venue from its value history. */
export interface VaultHistory {
  /** Growth of 1 dollar kept in the vault: deposits and withdrawals don't move it, gains and losses do. */
  points: Array<[time: number, index: number]>;
  returns: { d7: number | null; d30: number | null; d90: number | null; y1: number | null };
  /** Largest fall from a peak over the points shown (0.12 = -12%). */
  maxDrawdown: number | null;
  /** Orderly has no public value history: its own PnL and drawdown per period instead. */
  periods?: Array<{ range: string; pnl: number; maxDrawdown: number }>;
}
