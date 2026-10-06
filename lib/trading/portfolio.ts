import type { AccountSnapshot, PerpVenueId, VenuePosition } from "@/lib/venues/types";

/** Per-venue and total account figures for the portfolio view. Pure, unit-tested. */
export interface VenueSummary {
  venue: PerpVenueId;
  accountValue: number;
  withdrawable: number;
  unrealizedPnl: number;
  /** Margin locked by open positions: position value / leverage. */
  marginUsed: number;
  positions: number;
  orders: number;
}

function marginOf(position: VenuePosition) {
  return position.leverage > 0 ? position.positionValue / position.leverage : position.positionValue;
}

export function summarizeVenue(venue: PerpVenueId, snapshot: AccountSnapshot): VenueSummary {
  return {
    venue,
    accountValue: snapshot.accountValue,
    withdrawable: snapshot.withdrawable,
    unrealizedPnl: snapshot.positions.reduce((sum, position) => sum + position.unrealizedPnl, 0),
    marginUsed: snapshot.positions.reduce((sum, position) => sum + marginOf(position), 0),
    positions: snapshot.positions.length,
    orders: snapshot.orders.length,
  };
}

export function totalSummary(rows: VenueSummary[]) {
  return rows.reduce(
    (total, row) => ({
      accountValue: total.accountValue + row.accountValue,
      withdrawable: total.withdrawable + row.withdrawable,
      unrealizedPnl: total.unrealizedPnl + row.unrealizedPnl,
      marginUsed: total.marginUsed + row.marginUsed,
      positions: total.positions + row.positions,
      orders: total.orders + row.orders,
    }),
    { accountValue: 0, withdrawable: 0, unrealizedPnl: 0, marginUsed: 0, positions: 0, orders: 0 },
  );
}

/** Rows split by venue, venues in order of first appearance (so the list keeps its order inside each group). */
export function groupByVenue<T extends { venue: PerpVenueId }>(rows: T[]): Array<{ venue: PerpVenueId; rows: T[] }> {
  const groups = new Map<PerpVenueId, T[]>();
  for (const row of rows) groups.set(row.venue, [...(groups.get(row.venue) ?? []), row]);
  return [...groups].map(([venue, grouped]) => ({ venue, rows: grouped }));
}
